/**
 * WorkspaceEngine: executes the durable per-window switch state machine (ARCHITECTURE §5.3).
 *
 * `op.stage` is the stage being executed. Every stage is idempotent; after a stage completes the
 * op is persisted with `nextStage(op)`, so a worker killed at any point resumes by re-running
 * the persisted stage. Invariants: I1 window never empty (a created tab exists before anything
 * closes), I2 outgoing snapshot written before any close, I3 tab ids only inside the op record,
 * I4 TabTracker skips windows with an op, I5 one op per window (`busy`).
 *
 * Methods are un-laned: callers (CommandRouter, init, alarms) hold the lanes
 * [window:<id>, key:ws:index, key:ws:meta].
 */

import type {
  Color,
  SavedLink,
  SavedTab,
  SwitchOp,
  WindowState,
  WorkspaceId,
  WorkspaceMeta,
  WorkspaceTabs,
} from "../core/model/types";
import { Keys } from "../core/model/types";
import { snapshotWindow, snapshotWindowDetailed } from "../core/ops/snapshot";
import {
  BLANK_SAVED_TAB_ID,
  BLANK_TAB_URL,
  canResume,
  MAX_SWITCH_ATTEMPTS,
  nextStage,
  PlanError,
  planOpening,
  planSwitch,
} from "../core/ops/switch-planner";
import type { LiveTab, LiveWindow, OpeningPlan } from "../core/ops/types";
import {
  captureUrl,
  classifyUrl,
  isBlankPageUrl,
  isRestorableUrl,
  parsePlaceholderUrl,
  sanitizeFavIconUrl,
  unwrapUrl,
} from "../core/ops/url";
import { RpcError } from "../messaging/errors";
import { isNoTabError } from "../platform/errors";
import type { BgContext } from "./context";
import { BgKeys, type RecoveryEntry, type SwitchClosed } from "./keys";
import { Lane } from "./lanes";
import { hasOwnKey, isRecord, ownGet } from "./own";
import { emptyTabs } from "./repository";
import { removeTabsSafely } from "./tab-utils";

export interface EngineHooks {
  /** Test hook, called at every durable checkpoint ("persisted:<stage>", "chunk:<i>", "created:<savedTabId>"). */
  checkpoint?(point: string, op: SwitchOp): void | Promise<void>;
}

export interface EngineDeps {
  takeGeneration?(): Promise<unknown>;
  refreshBadge?(windowId: number): Promise<void>;
  markDirty?(windowId: number): void;
  hooks?: EngineHooks;
  /** Delay before automatically retrying a failed op (null: never; tests). */
  retryDelayMs?: number | null;
}

export interface SwitchResult {
  skipped: SavedTab[];
  /**
   * Directly created tabs that may exist twice after a worker restart (the create's result was
   * lost). Both copies are left open: without durable provenance a tab is never auto-closed.
   */
  possibleDuplicates?: SavedTab[];
}

const MAX_RECOVERY_ENTRIES = 20;
const CLOSED_BY_SWITCH_TTL = 10_000;
/** How long the durable (storage.session) closed-by-switch record is trusted. */
const SWITCH_CLOSED_TTL = 5 * 60_000;

/** The op record changed under us (committed, abandoned, or replaced by another op). */
export class OpSupersededError extends Error {
  override readonly name = "OpSupersededError";
}

export const switchLanes = (windowId: number): string[] => [
  Lane.window(windowId),
  Lane.wsIndex,
  Lane.wsMeta,
];

export class WorkspaceEngine {
  private readonly running = new Map<number, SwitchOp>();
  private readonly locked = new Set<number>();
  private readonly closedBySwitch = new Map<number, number>();
  /** Set when an op record may exist that no running switch owns. */
  mayHavePendingOps = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly ctx: BgContext,
    private readonly deps: EngineDeps = {},
  ) {}

  // ------------------------------------------------------------------ locking

  /** A switch is executing in this worker. */
  hasRunningOps(): boolean {
    return this.running.size > 0;
  }

  /** In-memory check: a switch is running or the window is being built by open/restore. */
  isBusy(windowId: number): boolean {
    return this.running.has(windowId) || this.locked.has(windowId);
  }

  /** True when TabTracker must leave the window alone (I4). */
  async isLocked(windowId: number): Promise<boolean> {
    if (this.isBusy(windowId)) return true;
    return (await this.ctx.repo.getOp(windowId)) !== null;
  }

  lockWindow(windowId: number): void {
    this.locked.add(windowId);
  }

  unlockWindow(windowId: number): void {
    this.locked.delete(windowId);
  }

  /**
   * Whether a tab removal was caused by a switch (so it is not "recently closed"). Not only
   * in-memory: the durable storage.session record written before the removals and the op record
   * itself (outgoing/created tab ids) are consulted, so a worker restart mid-switch does not
   * misread the switch's closures as the user's.
   */
  async wasClosedBySwitch(tabId: number, windowId?: number): Promise<boolean> {
    const at = this.closedBySwitch.get(tabId);
    if (at !== undefined && this.ctx.ports.now() - at < CLOSED_BY_SWITCH_TTL) return true;
    if (windowId === undefined) return false;
    const rec = await this.ctx.ports.session
      .get<SwitchClosed>(BgKeys.switchClosed(windowId))
      .catch(() => undefined);
    if (
      rec &&
      Array.isArray(rec.ids) &&
      rec.ids.includes(tabId) &&
      this.ctx.ports.now() - rec.at < SWITCH_CLOSED_TTL
    ) {
      return true;
    }
    const op = await this.ctx.repo.getOp(windowId).catch(() => null);
    return (
      op !== null &&
      (op.outgoingTabIds.includes(tabId) || Object.values(op.createdTabIds).includes(tabId))
    );
  }

  /**
   * Records (durably, in storage.session) tab ids this switch is about to close, and where each
   * one's content was saved (`saved`: workspace + SavedTab id).
   */
  private async noteClosedBySwitch(
    windowId: number,
    ids: readonly number[],
    saved?: { ws: string; sid: string },
  ): Promise<void> {
    if (ids.length === 0) return;
    const now = this.ctx.ports.now();
    for (const id of ids) this.closedBySwitch.set(id, now);
    for (const [id, at] of this.closedBySwitch) {
      if (now - at > CLOSED_BY_SWITCH_TTL) this.closedBySwitch.delete(id);
    }
    const key = BgKeys.switchClosed(windowId);
    try {
      const prev = await this.ctx.ports.session.get<SwitchClosed>(key);
      const fresh = prev && now - prev.at < SWITCH_CLOSED_TTL && Array.isArray(prev.ids);
      const next: SwitchClosed = {
        ids: [...new Set([...(fresh ? prev.ids : []), ...ids])],
        at: now,
        saved: { ...(fresh ? prev.saved : undefined) },
      };
      if (saved && next.saved) for (const id of ids) next.saved[String(id)] = saved;
      await this.ctx.ports.session.set({ [key]: next });
    } catch (e) {
      this.ctx.log.warn("[tabitat] closed-by-switch record", e);
    }
  }

  /**
   * tabs.onRemoved for a tab this switch closed (review S): a navigation can land between the
   * close-time revalidation and the removal. If the tab's last-known content differs from the
   * SavedTab written for it, that entry is updated (same id). Runs after the switch (window
   * lane), and only while the workspace is not open anywhere (else auto-save owns it).
   */
  async reconcileClosedTab(tabId: number, windowId: number, known: LiveTab): Promise<void> {
    const rec = await this.ctx.ports.session
      .get<SwitchClosed>(BgKeys.switchClosed(windowId))
      .catch(() => undefined);
    const target = ownGet(rec?.saved, tabId);
    if (!target) return;
    const raw = captureUrl(known);
    const ph = parsePlaceholderUrl(raw, this.ctx.placeholderBase);
    const url = ph?.u ?? raw;
    if (url.trim() === "" || isBlankPageUrl(url)) return;
    if (classifyUrl(url, this.ctx.classifyOptions()) === "skip") return;
    const title = ph ? ph.t || known.title : known.title;
    await this.ctx.lanes.run([Lane.window(windowId)], async () => {
      if ((await this.ownerOf(target.ws)) !== null) return;
      const { repo, ports } = this.ctx;
      const cur = await repo.getWorkspaceTabs(target.ws);
      const entry = cur?.tabs.find((t) => t.id === target.sid);
      if (!cur || !entry || (entry.url === url && entry.title === title)) return;
      await repo.setMany({
        [Keys.wsTabs(target.ws)]: {
          ...cur,
          tabs: cur.tabs.map((t) => (t.id === entry.id ? { ...t, url, title } : t)),
          updatedAt: ports.now(),
          rev: cur.rev + 1,
        } satisfies WorkspaceTabs,
      });
    });
  }

  status(windowId: number): SwitchOp | null {
    return this.running.get(windowId) ?? null;
  }

  // ------------------------------------------------------------------ switch

  async switchWorkspace(
    windowId: number,
    to: WorkspaceId,
    opts: { discardOutgoing?: boolean } = {},
  ): Promise<SwitchResult> {
    const { repo, ports } = this.ctx;
    if (this.running.has(windowId))
      throw new RpcError("busy", "a switch is running in this window");
    if (await repo.getOp(windowId)) {
      this.mayHavePendingOps = true;
      throw new RpcError("busy", "a previous switch in this window is still pending");
    }
    const target = await repo.getWorkspace(to);
    if (!target) throw new RpcError("not_found", `workspace ${to} not found`);
    const window = await this.ctx.getWindow(windowId);
    if (!window) throw new RpcError("not_found", `window ${windowId} not found`);

    const state = await repo.getWindowState(windowId);
    let from: WorkspaceId | null = opts.discardOutgoing ? null : (state?.activeWorkspaceId ?? null);
    if (from !== null && from === to) throw new PlanError("same_workspace");
    const owner = await this.ownerOf(to);
    if (owner !== null && owner !== windowId) {
      throw new RpcError("conflict", `workspace is already open in window ${owner}`, false);
    }

    let fromTabs: WorkspaceTabs | null = null;
    if (from !== null) {
      const fw = await repo.getWorkspace(from);
      if (fw) fromTabs = fw.tabs;
      else from = null;
    }
    if (from === null && !opts.discardOutgoing) {
      // TabTracker has not created the window's Unsorted workspace yet: do it now so the
      // outgoing tabs have somewhere to be saved (never close an unsaved tab).
      const snap = snapshotWindow(window, null, this.ctx.snapshotOptions());
      if (snap.tabs.length > 0) {
        from = (await this.ctx.createUnsorted(windowId, null)).id;
      }
    }

    const settings = await repo.getSettings();
    if (this.deps.takeGeneration) {
      try {
        await this.deps.takeGeneration();
      } catch (e) {
        this.ctx.log.warn("[tabitat] pre-switch session generation failed", e);
      }
    }

    const plan = planSwitch({
      window,
      from,
      to,
      fromTabs,
      toTabs: target.tabs,
      sessionEpoch: this.ctx.epoch,
      now: ports.now(),
      restoreLimit: settings.restoreLimit,
      placeholderBase: this.ctx.placeholderBase,
      newId: ports.newId,
      directSchemes: this.ctx.directSchemes,
      ownOrigin: this.ctx.ownOrigin,
    });
    const op = plan.op;
    // Intent first: if this write fails nothing has happened.
    await this.writeOp(op, { create: true });
    this.running.set(windowId, op);
    try {
      await this.checkpoint("persisted:snapshot", op);
      const snapshot = plan.outgoingSnapshot === fromTabs ? null : plan.outgoingSnapshot;
      return await this.execute(op, { snapshot, opening: plan.opening });
    } finally {
      this.running.delete(windowId);
    }
  }

  /** Continues a persisted op from its stage (after canResume said "resume"). */
  async resume(op: SwitchOp): Promise<SwitchResult> {
    if (this.running.has(op.windowId)) throw new RpcError("busy", "switch already running");
    op.attempts += 1;
    await this.writeOp(op);
    this.running.set(op.windowId, op);
    try {
      return await this.execute(op, null);
    } finally {
      this.running.delete(op.windowId);
    }
  }

  /**
   * Gives up on an op without deleting anything: the frozen `incoming` list and a copy of the
   * outgoing snapshot go to `recovery:pending` (for the recovery screen), then the op record is
   * removed. Tabs are left as they are.
   */
  async abandon(op: SwitchOp, reason: string): Promise<void> {
    const { repo, ports } = this.ctx;
    const fromSnapshot = op.from ? await repo.getWorkspaceTabs(op.from) : null;
    const pending = await repo.getRecoveryPending();
    const entry: RecoveryEntry = {
      opId: op.id,
      windowId: op.windowId,
      from: op.from,
      to: op.to,
      stage: op.stage,
      incoming: op.incoming,
      fromSnapshot,
      reason,
      abandonedAt: ports.now(),
    };
    const entries = [...pending.entries.filter((e) => e.opId !== op.id), entry].slice(
      -MAX_RECOVERY_ENTRIES,
    );
    const writes: Record<string, unknown> = { [BgKeys.recoveryPending]: { entries } };
    // The window may hold placeholders of `to` (and, after activating, leftovers of `from`): never
    // let auto-save absorb a half-switched window into either workspace. It falls back to
    // Unsorted (the next flush adopts its live tabs); `from`'s snapshot stays as written at the
    // snapshot stage.
    const st = await repo.getWindowState(op.windowId);
    if (st && st.activeWorkspaceId !== null) {
      writes[Keys.window(op.windowId)] = {
        activeWorkspaceId: null,
        sessionEpoch: this.ctx.epoch,
      } satisfies WindowState;
    }
    await repo.setMany(writes);
    await this.removeOpIf(op);
    this.ctx.log.warn("[tabitat] switch abandoned", op.windowId, reason);
    this.deps.markDirty?.(op.windowId);
  }

  /** Resume-or-abandon one persisted op. Caller holds the window lanes (or runs inside init). */
  async resumeOrAbandon(op: SwitchOp): Promise<"resumed" | "abandoned" | "failed"> {
    if (op.sessionEpoch !== this.ctx.epoch) {
      // The worker context was reset (browser restart, extension reload/update): tab ids may
      // mean something else now (I3). Abandon: nothing is deleted.
      await this.abandon(op, "session changed");
      return "abandoned";
    }
    const win = await this.ctx.getWindow(op.windowId);
    if (!win) {
      await this.abandon(op, "window closed");
      return "abandoned";
    }
    const live = new Set(win.tabs.map((t) => t.id));
    const decision = canResume(op, live, this.ctx.epoch);
    if (decision === "abandon") {
      const reason =
        op.attempts >= MAX_SWITCH_ATTEMPTS ? "too many attempts" : "tabs changed during the switch";
      await this.abandon(op, reason);
      return "abandoned";
    }
    try {
      await this.resume(op);
      return "resumed";
    } catch (e) {
      this.ctx.log.error("[tabitat] resume failed", op.windowId, e);
      this.mayHavePendingOps = true;
      this.scheduleRetry();
      return "failed";
    }
  }

  /**
   * Alarm/retry path: rediscovers durable op records (storage.local, not an in-memory flag) that
   * nobody is running and resumes or abandons them.
   */
  async resumePending(): Promise<void> {
    this.mayHavePendingOps = false;
    const ops = await this.ctx.repo.listOps();
    for (const op of ops) {
      if (this.running.has(op.windowId)) continue;
      await this.ctx.lanes
        .run(switchLanes(op.windowId), async () => {
          const fresh = await this.ctx.repo.getOp(op.windowId);
          if (!fresh || this.running.has(op.windowId)) return;
          await this.resumeOrAbandon(fresh);
        })
        .catch((e) => {
          this.mayHavePendingOps = true;
          this.ctx.log.error("[tabitat] resumePending", e);
        });
    }
  }

  /**
   * tabs.onReplaced (discard): rewrite the old id in running and persisted ops (I3).
   * A running op is patched in memory only: its execution owns the record and persists it at its
   * next checkpoint. A stalled op (discovered from storage) is patched under its window lane after
   * re-reading it, so it never races resume or resurrects a committed op.
   */
  async onTabReplaced(added: number, removed: number): Promise<void> {
    const patch = (op: SwitchOp): boolean => {
      let changed = false;
      op.outgoingTabIds = op.outgoingTabIds.map((id) => {
        if (id !== removed) return id;
        changed = true;
        return added;
      });
      const saved = ownGet(op.outgoingSavedIds, removed);
      if (op.outgoingSavedIds && saved !== undefined) {
        delete op.outgoingSavedIds[removed];
        op.outgoingSavedIds[added] = saved;
      }
      for (const [k, id] of Object.entries(op.createdTabIds)) {
        if (id === removed) {
          op.createdTabIds[k] = added;
          changed = true;
        }
      }
      return changed;
    };
    for (const op of this.running.values()) patch(op);
    for (const op of await this.ctx.repo.listOps()) {
      if (this.running.has(op.windowId)) continue;
      if (!patch(structuredClone(op))) continue;
      await this.ctx.lanes
        .run([Lane.window(op.windowId)], async () => {
          if (this.running.has(op.windowId)) return;
          const fresh = await this.ctx.repo.getOp(op.windowId);
          if (!fresh || fresh.id !== op.id) return;
          if (patch(fresh)) await this.writeOp(fresh);
        })
        .catch((e) => this.ctx.log.warn("[tabitat] op id patch", e));
    }
  }

  private scheduleRetry(): void {
    const delay = this.deps.retryDelayMs === undefined ? 5_000 : this.deps.retryDelayMs;
    if (delay === null || this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.resumePending();
    }, delay);
  }

  /**
   * The single writer of op records (stage transitions, createdTabIds, blank tab, id patches).
   * Callers hold the window lane. Re-reads the stored record first: a create must find none, an
   * update must find the same op (by id) — a committed or abandoned op is never written back.
   */
  private async writeOp(op: SwitchOp, opts: { create?: boolean } = {}): Promise<void> {
    const key = Keys.opSwitch(op.windowId);
    const stored = await this.ctx.repo.store.get<unknown>(key);
    if (opts.create) {
      if (stored !== undefined) throw new RpcError("busy", "a switch is pending in this window");
    } else if (!isRecord(stored) || stored.id !== op.id) {
      throw new OpSupersededError(`op ${op.id} for window ${op.windowId} is no longer current`);
    }
    await this.ctx.repo.setMany({ [key]: op });
  }

  /** Removes the op record if it is still this op. */
  private async removeOpIf(op: SwitchOp, extra: string[] = []): Promise<void> {
    const key = Keys.opSwitch(op.windowId);
    const stored = await this.ctx.repo.store.get<unknown>(key);
    const mine = isRecord(stored) && stored.id === op.id;
    const keys = mine ? [key, ...extra] : extra;
    if (keys.length > 0) await this.ctx.repo.remove(keys);
  }

  private async checkpoint(point: string, op: SwitchOp): Promise<void> {
    await this.deps.hooks?.checkpoint?.(point, op);
  }

  private async execute(
    op: SwitchOp,
    first: { snapshot: WorkspaceTabs | null; opening: OpeningPlan } | null,
  ): Promise<SwitchResult> {
    for (;;) {
      const stage = op.stage;
      try {
        switch (stage) {
          case "snapshot":
            await this.stageSnapshot(op, first ? first.snapshot : undefined);
            break;
          case "opening":
            await this.stageOpening(op, first?.opening);
            break;
          case "activating":
            await this.stageActivating(op);
            break;
          case "closing":
            await this.stageClosing(op);
            break;
          case "done":
            return await this.stageDone(op);
        }
        // The transition write is part of the stage: if it fails, the op stays at `stage`
        // (stages are idempotent) and is retried like any other stage failure.
        op.stage = nextStage(op);
        await this.writeOp(op);
      } catch (e) {
        op.stage = stage;
        if (stage === "snapshot" && !(e instanceof OpSupersededError)) {
          // Nothing has been touched yet (I2): roll the intent back so the user can retry.
          await this.removeOpIf(op).catch(() => {
            this.mayHavePendingOps = true;
          });
        } else if (!(e instanceof OpSupersededError)) {
          this.mayHavePendingOps = true;
          this.scheduleRetry();
        }
        throw e;
      }
      await this.checkpoint(`persisted:${op.stage}`, op);
    }
  }

  /** I2: the outgoing workspace's snapshot is persisted before anything is closed. */
  private async stageSnapshot(
    op: SwitchOp,
    given: WorkspaceTabs | null | undefined,
  ): Promise<void> {
    if (op.from === null) return;
    if (given !== undefined) {
      if (given) await this.ctx.repo.setMany({ [Keys.wsTabs(op.from)]: given });
      return;
    }
    // Resumed: re-snapshot the live window (nothing has been created yet in this stage).
    const win = await this.ctx.getWindow(op.windowId);
    if (!win) throw new Error(`window ${op.windowId} is gone`);
    const created = new Set(Object.values(op.createdTabIds));
    const tabs = win.tabs.filter((t) => !created.has(t.id));
    const prev = await this.ctx.repo.getWorkspaceTabs(op.from);
    const { snapshot: snap, savedIdByTabId } = snapshotWindowDetailed(
      { ...win, tabs },
      prev,
      this.ctx.snapshotOptions(),
    );
    const classify = this.ctx.classifyOptions();
    op.outgoingTabIds = tabs
      .filter((t) => {
        if (t.pinned) return false;
        const real = unwrapUrl(captureUrl(t), this.ctx.placeholderBase);
        return isBlankPageUrl(real) || classifyUrl(real, classify) !== "skip";
      })
      .map((t) => t.id);
    op.outgoingSavedIds = {};
    for (const id of op.outgoingTabIds) {
      const sid = savedIdByTabId.get(id);
      if (sid !== undefined) op.outgoingSavedIds[id] = sid;
    }
    if (snap !== prev) await this.ctx.repo.setMany({ [Keys.wsTabs(op.from)]: snap });
  }

  private async stageOpening(op: SwitchOp, given: OpeningPlan | undefined): Promise<void> {
    const { ports } = this.ctx;
    const win = await this.ctx.getWindow(op.windowId);
    if (!win) throw new Error(`window ${op.windowId} is gone`);
    const live = new Set(win.tabs.map((t) => t.id));
    for (const [sid, tid] of Object.entries(op.createdTabIds)) {
      if (!live.has(tid)) delete op.createdTabIds[sid];
    }
    // A worker that died right after tabs.create returned browser-side never recorded the tab:
    // Adopt placeholders created before a crash but not yet recorded (no duplicates on resume).
    const outgoing = new Set(op.outgoingTabIds);
    const recorded = new Set(Object.values(op.createdTabIds));
    const incomingIds = new Set(op.incoming.map((t) => t.id));
    for (const t of win.tabs) {
      if (outgoing.has(t.id) || recorded.has(t.id)) continue;
      const ph = parsePlaceholderUrl(t.url, this.ctx.placeholderBase);
      if (!ph || ph.w !== op.to || !incomingIds.has(ph.s) || hasOwnKey(op.createdTabIds, ph.s)) {
        continue;
      }
      op.createdTabIds[ph.s] = t.id;
      recorded.add(t.id);
    }

    let plan = given;
    if (!plan) {
      const skippedIds = new Set(op.skipped.map((t) => t.id));
      const openingOpts: Parameters<typeof planOpening>[1] = {
        workspaceId: op.to,
        pinnedCount: win.tabs.filter((t) => t.pinned).length,
        restoreLimit: Number.MAX_SAFE_INTEGER,
        placeholderBase: this.ctx.placeholderBase,
        directSchemes: this.ctx.directSchemes,
        ownOrigin: this.ctx.ownOrigin,
      };
      if (op.activeSavedTabId !== undefined) openingOpts.activeSavedTabId = op.activeSavedTabId;
      plan = planOpening(
        op.incoming.filter((t) => !skippedIds.has(t.id)),
        openingOpts,
      );
      for (const t of plan.skipped) if (!skippedIds.has(t.id)) op.skipped.push(t);
    }

    for (const [i, chunk] of plan.chunks.entries()) {
      let progressed = false;
      try {
        for (const spec of chunk) {
          if (hasOwnKey(op.createdTabIds, spec.savedTabId)) continue;
          const tab = await ports.tabs.create({
            windowId: op.windowId,
            url: spec.url,
            index: spec.index,
            active: false,
          });
          op.createdTabIds[spec.savedTabId] = tab.id;
          progressed = true;
          await this.checkpoint(`created:${spec.savedTabId}`, op);
        }
      } catch (e) {
        // Record what was created so a resume does not create it twice.
        if (progressed) await this.writeOp(op).catch((err) => this.ctx.log.warn(err));
        throw e;
      }
      if (progressed) await this.writeOp(op);
      await this.checkpoint(`chunk:${i}`, op);
    }

    for (const g of plan.groups) {
      const ids = g.savedTabIds
        .map((s) => ownGet(op.createdTabIds, s))
        .filter((id): id is number => id !== undefined);
      if (ids.length === 0) continue;
      const groupId = await ports.tabs.group(ids, op.windowId);
      await ports.tabs.updateGroup(groupId, {
        title: g.title,
        color: g.color,
        collapsed: g.collapsed,
      });
    }
  }

  /** Activates the saved active tab (never waits for it to load: spike finding 4). */
  private async stageActivating(op: SwitchOp): Promise<void> {
    const created = op.createdTabIds;
    const firstIncoming = op.incoming
      .map((t) => ownGet(created, t.id))
      .find((id) => id !== undefined);
    const target =
      (op.activeSavedTabId !== undefined ? ownGet(created, op.activeSavedTabId) : undefined) ??
      firstIncoming ??
      ownGet(created, BLANK_SAVED_TAB_ID);
    if (target !== undefined) {
      try {
        await this.ctx.ports.tabs.update(target, { active: true });
      } catch (e) {
        if (!isNoTabError(e)) throw e;
      }
    }
    // A user-initiated switch ends a provisional (reconciled) association: fresh record, and the
    // workspace's pre-reconciliation copy (ws:prev) is released.
    const prevState = await this.ctx.repo.getWindowState(op.windowId);
    if (prevState?.provisional && prevState.activeWorkspaceId !== null) {
      await this.ctx.repo.remove(Keys.wsPrev(prevState.activeWorkspaceId));
    }
    await this.ctx.repo.setMany({
      [Keys.window(op.windowId)]: {
        activeWorkspaceId: op.to,
        sessionEpoch: this.ctx.epoch,
      } satisfies WindowState,
    });
  }

  /**
   * Removes the outgoing tabs one id at a time (spike S7). Pinned/retained tabs are never listed.
   * Each tab is revalidated right before its removal (review bug 1): a tab that is gone, now
   * pinned, moved to another window, or now unrestorable is retained (left open); a tab whose
   * content differs from its saved entry is written to `ws:tabs:<from>` first (same SavedTab id).
   */
  private async stageClosing(op: SwitchOp): Promise<void> {
    if (op.outgoingTabIds.length === 0) return;
    const { ports } = this.ctx;
    const win = await this.ctx.getWindow(op.windowId);
    if (!win) return;
    const outgoing = new Set(op.outgoingTabIds);
    // I1: something other than the outgoing tabs must remain.
    if (win.tabs.every((t) => outgoing.has(t.id))) {
      const blank = await ports.tabs.create({
        windowId: op.windowId,
        url: BLANK_TAB_URL,
        active: true,
      });
      op.createdTabIds[BLANK_SAVED_TAB_ID] = blank.id;
      await this.writeOp(op);
    }
    for (const id of op.outgoingTabIds) {
      const tab = await ports.tabs.get(id);
      if (!tab) continue; // already gone (or unknown): nothing to close
      const v = await this.saveBeforeClose(op, tab);
      if (!v.close) continue; // retained
      await this.checkpoint(`closing:validated:${id}`, op);
      // Durable "closed by this switch" mark first (a worker restart must not misread it),
      // with where the content went (a late navigation is reconciled on the removal event).
      await this.noteClosedBySwitch(
        op.windowId,
        [id],
        v.savedId !== undefined && op.from !== null ? { ws: op.from, sid: v.savedId } : undefined,
      );
      await removeTabsSafely(ports.tabs, [id]);
    }
  }

  /**
   * Revalidates one outgoing tab. `close` when it may be closed (its current content is durably
   * saved in `from` as SavedTab `savedId`, or it is blank); otherwise it is retained.
   */
  private async saveBeforeClose(
    op: SwitchOp,
    tab: LiveTab,
  ): Promise<{ close: boolean; savedId?: string }> {
    const { repo, ports } = this.ctx;
    if (tab.windowId !== op.windowId || tab.pinned) return { close: false };
    const raw = captureUrl(tab);
    const ph = parsePlaceholderUrl(raw, this.ctx.placeholderBase);
    const url = ph?.u ?? raw;
    if (url.trim() === "" || isBlankPageUrl(url)) return { close: true };
    if (classifyUrl(url, this.ctx.classifyOptions()) === "skip") return { close: false };
    if (op.from === null) return { close: false }; // nowhere to save it
    const title = ph ? ph.t || tab.title : tab.title;
    const cur = (await repo.getWorkspaceTabs(op.from)) ?? emptyTabs(ports.now());
    const savedId = ownGet(op.outgoingSavedIds, tab.id);
    const entry =
      savedId !== undefined
        ? cur.tabs.find((t) => t.id === savedId)
        : op.outgoingSavedIds === undefined
          ? cur.tabs.find((t) => t.url === url) // op written before outgoingSavedIds existed
          : undefined;
    if (entry && entry.url === url && entry.title === title)
      return { close: true, savedId: entry.id };
    const favIconUrl = ph ? entry?.favIconUrl : sanitizeFavIconUrl(tab.favIconUrl);
    let tabs: SavedTab[];
    let newSavedId: string;
    if (entry) {
      newSavedId = entry.id;
      tabs = cur.tabs.map((t) => {
        if (t.id !== entry.id) return t;
        const next: SavedTab = { ...t, url, title };
        if (favIconUrl) next.favIconUrl = favIconUrl;
        else delete next.favIconUrl;
        return next;
      });
    } else {
      const index = cur.tabs.reduce((m, t) => Math.max(m, t.index + 1), 0);
      const added: SavedTab = { id: ports.newId(), url, title, index };
      if (favIconUrl) added.favIconUrl = favIconUrl;
      newSavedId = added.id;
      tabs = [...cur.tabs, added];
    }
    await repo.setMany({
      [Keys.wsTabs(op.from)]: {
        ...cur,
        tabs,
        updatedAt: ports.now(),
        rev: cur.rev + 1,
      } satisfies WorkspaceTabs,
    });
    return { close: true, savedId: newSavedId };
  }

  /**
   * After a resumed op (review R): closes only duplicates with durable provenance — a placeholder
   * of `to` whose `s` hint names a saved tab that this op recorded as created in ANOTHER live
   * tab. A directly created tab (chrome://, our pages) has no such provenance: a suspected
   * duplicate (an unrecorded tab with the same URL) is left open and reported. Outgoing and
   * pinned tabs are never touched.
   */
  private async dedupeAfterResume(
    op: SwitchOp,
    win: LiveWindow,
  ): Promise<{ closed: boolean; possible: SavedTab[] }> {
    const base = this.ctx.placeholderBase;
    const recorded = new Map<number, string>();
    for (const [sid, tid] of Object.entries(op.createdTabIds)) recorded.set(tid, sid);
    const outgoing = new Set(op.outgoingTabIds);
    const candidates = win.tabs.filter((t) => !t.pinned && !outgoing.has(t.id));
    const liveIds = new Set(candidates.map((t) => t.id));
    const close: number[] = [];
    for (const t of candidates) {
      if (recorded.has(t.id)) continue;
      const ph = parsePlaceholderUrl(t.url, base);
      if (!ph || ph.w !== op.to) continue;
      const rec = ownGet(op.createdTabIds, ph.s);
      if (rec !== undefined && rec !== t.id && liveIds.has(rec)) close.push(t.id);
    }
    const possible: SavedTab[] = [];
    const byUrl = new Map<string, string>();
    for (const t of candidates) {
      const sid = recorded.get(t.id);
      if (sid !== undefined && !parsePlaceholderUrl(t.url, base)) byUrl.set(t.url, sid);
    }
    for (const t of candidates) {
      if (recorded.has(t.id) || close.includes(t.id)) continue;
      const sid = byUrl.get(t.url);
      const saved = sid !== undefined ? op.incoming.find((x) => x.id === sid) : undefined;
      if (saved && !possible.includes(saved)) possible.push(saved);
    }
    if (possible.length > 0) {
      this.ctx.log.warn("[tabitat] possible duplicate tabs after resume (left open)", possible);
    }
    if (close.length === 0) return { closed: false, possible };
    await this.noteClosedBySwitch(op.windowId, close);
    await removeTabsSafely(this.ctx.ports.tabs, close);
    return { closed: true, possible };
  }

  /** Full re-snapshot into ws:tabs:<to>, skipped tabs kept as saved links, then commit (delete op). */
  private async stageDone(op: SwitchOp): Promise<SwitchResult> {
    const { repo, ports } = this.ctx;
    const writes: Record<string, unknown> = {};
    let win = await this.ctx.getWindow(op.windowId);
    let possibleDuplicates: SavedTab[] = [];
    if (win && op.attempts > 0) {
      const d = await this.dedupeAfterResume(op, win);
      possibleDuplicates = d.possible;
      if (d.closed) win = await this.ctx.getWindow(op.windowId);
    }
    if (win) {
      const prev = await repo.getWorkspaceTabs(op.to);
      const snap = snapshotWindow(win, prev, this.ctx.snapshotOptions());
      if (snap !== prev) writes[Keys.wsTabs(op.to)] = snap;
    }
    // Tabs that were not opened (restore limit, other browser's scheme) would otherwise vanish
    // from the workspace at its next auto-save: keep them as saved links.
    const keep = op.skipped.filter((t) => isRestorableUrl(t.url));
    if (keep.length > 0) {
      const meta = await repo.getWorkspaceMeta(op.to);
      if (meta) {
        const have = new Set(meta.resources.map((r) => r.url));
        let order = meta.resources.reduce((m, r) => Math.max(m, r.order), -1);
        const added: SavedLink[] = [];
        for (const t of keep) {
          if (have.has(t.url)) continue;
          have.add(t.url);
          added.push({
            id: ports.newId(),
            url: t.url,
            title: t.title,
            order: ++order,
            addedAt: ports.now(),
          });
        }
        if (added.length > 0) {
          writes[Keys.wsMeta(op.to)] = {
            ...meta,
            resources: [...meta.resources, ...added],
            updatedAt: ports.now(),
            rev: meta.rev + 1,
          } satisfies WorkspaceMeta;
        }
      }
    }
    if (Object.keys(writes).length > 0) await repo.setMany(writes);
    await this.removeOpIf(op, [Keys.dirty(op.windowId)]);
    if (this.deps.refreshBadge) {
      await this.deps.refreshBadge(op.windowId).catch((e) => this.ctx.log.warn(e));
    }
    return possibleDuplicates.length > 0
      ? { skipped: op.skipped, possibleDuplicates }
      : { skipped: op.skipped };
  }

  // ------------------------------------------------------------------ other workspace ops

  /**
   * windows:* records that describe a live window of this session: the window id is in
   * windows.getAll() and the record carries the current epoch (a record from a previous browser
   * session may name a window id that was reused).
   */
  async liveWindowStates(): Promise<Map<number, WindowState>> {
    const states = await this.ctx.repo.listWindowStates();
    const live = new Set((await this.ctx.ports.windows.getAll()).map((w) => w.id));
    const out = new Map<number, WindowState>();
    for (const [windowId, st] of states) {
      if (live.has(windowId) && st.sessionEpoch === this.ctx.epoch) out.set(windowId, st);
    }
    return out;
  }

  /** Live window (see liveWindowStates) whose record has `id` active, else null. */
  async ownerOf(id: WorkspaceId): Promise<number | null> {
    for (const [windowId, st] of await this.liveWindowStates()) {
      if (st.activeWorkspaceId === id) return windowId;
    }
    return null;
  }

  /** Opens a workspace in a new window (or returns the window it is already open in). */
  async openInNewWindow(workspaceId: WorkspaceId): Promise<{ windowId: number }> {
    const ws = await this.ctx.repo.getWorkspace(workspaceId);
    if (!ws) throw new RpcError("not_found", `workspace ${workspaceId} not found`);
    const owner = await this.ownerOf(workspaceId);
    if (owner !== null) return { windowId: owner };
    const win = await this.ctx.ports.windows.create({ url: BLANK_TAB_URL, focused: true });
    this.lockWindow(win.id);
    try {
      await this.switchWorkspace(win.id, workspaceId, { discardOutgoing: true });
    } finally {
      this.unlockWindow(win.id);
    }
    return { windowId: win.id };
  }

  /**
   * Creates a named workspace. With `fromWindowId`, the window's current tabs become the new
   * workspace and it becomes the window's active workspace; no tab is closed. An Unsorted
   * workspace that was active there is folded into it.
   */
  async createWorkspace(name: string, color: Color, fromWindowId?: number): Promise<WorkspaceMeta> {
    const { repo, ports } = this.ctx;
    const now = ports.now();
    const id = ports.newId();
    const meta: WorkspaceMeta = {
      id,
      name,
      color,
      kind: "named",
      resources: [],
      createdAt: now,
      updatedAt: now,
      rev: 1,
    };
    let index = await repo.getWorkspaceIndex();
    const writes: Record<string, unknown> = { [Keys.wsTabs(id)]: { ...emptyTabs(now), rev: 1 } };
    const removals: string[] = [];
    if (fromWindowId !== undefined) {
      if (await this.isLocked(fromWindowId)) {
        throw new RpcError("busy", "a switch is running in this window");
      }
      const win = await this.ctx.getWindow(fromWindowId);
      if (!win) throw new RpcError("not_found", `window ${fromWindowId} not found`);
      const state = await repo.getWindowState(fromWindowId);
      const prev = state?.activeWorkspaceId
        ? await repo.getWorkspace(state.activeWorkspaceId)
        : null;
      const adoptUnsorted = prev?.meta.kind === "unsorted";
      const snap = snapshotWindow(
        win,
        adoptUnsorted ? (prev?.tabs ?? null) : null,
        this.ctx.snapshotOptions(),
      );
      writes[Keys.wsTabs(id)] = { ...snap, updatedAt: now };
      writes[Keys.window(fromWindowId)] = { activeWorkspaceId: id, sessionEpoch: this.ctx.epoch };
      meta.windowHint = fromWindowId;
      if (prev && adoptUnsorted) {
        index = index.filter((x) => x !== prev.meta.id);
        removals.push(Keys.wsMeta(prev.meta.id), Keys.wsTabs(prev.meta.id));
      }
    }
    writes[Keys.wsMeta(id)] = meta;
    writes[Keys.wsIndex] = [...index, id];
    await repo.setMany(writes);
    if (removals.length > 0) await repo.remove(removals);
    if (fromWindowId !== undefined && this.deps.refreshBadge) {
      await this.deps.refreshBadge(fromWindowId).catch((e) => this.ctx.log.warn(e));
    }
    return meta;
  }

  /**
   * Moves a workspace to the trash (meta + tabs copy written before anything is removed).
   * Windows where it is active keep their tabs; they fall back to an Unsorted workspace.
   */
  async deleteWorkspace(id: WorkspaceId): Promise<{ trashId: string }> {
    const { repo, ports } = this.ctx;
    const ws = await repo.getWorkspace(id);
    if (!ws) throw new RpcError("not_found", `workspace ${id} not found`);
    for (const op of this.running.values()) {
      if (op.from === id || op.to === id) throw new RpcError("busy", "workspace is being switched");
    }
    for (const op of await repo.listOps()) {
      if (op.from === id || op.to === id)
        throw new RpcError("busy", "workspace has a pending switch");
    }
    const trash = await repo.getTrash();
    const trashId = ports.newId();
    trash.items.push({
      id: trashId,
      kind: "workspace",
      deletedAt: ports.now(),
      meta: ws.meta,
      tabs: ws.tabs,
    });
    const index = (await repo.getWorkspaceIndex()).filter((x) => x !== id);
    const writes: Record<string, unknown> = { [Keys.trash]: trash, [Keys.wsIndex]: index };
    const affected: number[] = [];
    for (const [windowId, st] of await repo.listWindowStates()) {
      if (st.activeWorkspaceId !== id) continue;
      writes[Keys.window(windowId)] = { activeWorkspaceId: null, sessionEpoch: st.sessionEpoch };
      affected.push(windowId);
    }
    await repo.setMany(writes);
    await repo.remove([Keys.wsMeta(id), Keys.wsTabs(id), Keys.wsPrev(id)]);
    for (const w of affected) this.deps.markDirty?.(w);
    return { trashId };
  }

  /** Switches to the next/previous named workspace not open in another window. */
  async nextWorkspace(windowId: number, dir: 1 | -1): Promise<{ workspaceId: WorkspaceId | null }> {
    const { repo } = this.ctx;
    const states = await this.liveWindowStates();
    const current = states.get(windowId)?.activeWorkspaceId ?? null;
    const elsewhere = new Set<string>();
    for (const [w, st] of states) {
      if (w !== windowId && st.activeWorkspaceId) elsewhere.add(st.activeWorkspaceId);
    }
    const list = (await repo.listWorkspaces())
      .filter((w) => w.meta.kind === "named")
      .filter((w) => w.meta.id === current || !elsewhere.has(w.meta.id));
    if (list.length === 0) return { workspaceId: null };
    const idx = list.findIndex((w) => w.meta.id === current);
    const nextIdx =
      idx === -1 ? (dir === 1 ? 0 : list.length - 1) : (idx + dir + list.length) % list.length;
    const target = list[nextIdx];
    if (!target || target.meta.id === current) return { workspaceId: null };
    await this.switchWorkspace(windowId, target.meta.id);
    return { workspaceId: target.meta.id };
  }
}
