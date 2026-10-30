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
  WorkspaceId,
  WorkspaceMeta,
  WorkspaceTabs,
} from "../core/model/types";
import { Keys } from "../core/model/types";
import { snapshotWindow } from "../core/ops/snapshot";
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
import type { OpeningPlan } from "../core/ops/types";
import { classifyUrl, isRestorableUrl, parsePlaceholderUrl, unwrapUrl } from "../core/ops/url";
import { RpcError } from "../messaging/errors";
import { isNoTabError } from "../platform/errors";
import type { BgContext } from "./context";
import { BgKeys, type RecoveryEntry } from "./keys";
import { Lane } from "./lanes";
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
}

const MAX_RECOVERY_ENTRIES = 20;
const CLOSED_BY_SWITCH_TTL = 10_000;

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

  /** Whether a tab id was closed by a switch in the last few seconds (not "recently closed"). */
  wasClosedBySwitch(tabId: number): boolean {
    const at = this.closedBySwitch.get(tabId);
    return at !== undefined && this.ctx.ports.now() - at < CLOSED_BY_SWITCH_TTL;
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
    });
    const op = plan.op;
    // Intent first: if this write fails nothing has happened.
    await this.persist(op);
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
    await this.persist(op);
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
    await repo.setMany({ [BgKeys.recoveryPending]: { entries } });
    await repo.remove(Keys.opSwitch(op.windowId));
    this.ctx.log.warn("[tabitat] switch abandoned", op.windowId, reason);
    this.deps.markDirty?.(op.windowId);
  }

  /** Resume-or-abandon one persisted op. Caller holds the window lanes (or runs inside init). */
  async resumeOrAbandon(op: SwitchOp): Promise<"resumed" | "abandoned" | "failed"> {
    if (op.sessionEpoch !== this.ctx.epoch) {
      // Window and tab ids from another browser session mean nothing now (I3).
      await this.abandon(op, "browser restarted");
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

  /** Alarm/retry path: finds op records nobody is running and resumes or abandons them. */
  async resumePending(): Promise<void> {
    if (!this.mayHavePendingOps) return;
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

  /** tabs.onReplaced (discard): rewrite the old id in running and persisted ops (I3). */
  async onTabReplaced(added: number, removed: number): Promise<void> {
    const patch = (op: SwitchOp): boolean => {
      let changed = false;
      op.outgoingTabIds = op.outgoingTabIds.map((id) => {
        if (id !== removed) return id;
        changed = true;
        return added;
      });
      for (const [k, id] of Object.entries(op.createdTabIds)) {
        if (id === removed) {
          op.createdTabIds[k] = added;
          changed = true;
        }
      }
      return changed;
    };
    for (const op of this.running.values()) {
      if (patch(op)) await this.persist(op).catch((e) => this.ctx.log.warn(e));
    }
    if (!this.mayHavePendingOps) return;
    for (const op of await this.ctx.repo.listOps()) {
      if (this.running.has(op.windowId)) continue;
      if (patch(op)) await this.persist(op).catch((e) => this.ctx.log.warn(e));
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

  private async persist(op: SwitchOp): Promise<void> {
    await this.ctx.repo.setMany({ [Keys.opSwitch(op.windowId)]: op });
  }

  private async checkpoint(point: string, op: SwitchOp): Promise<void> {
    await this.deps.hooks?.checkpoint?.(point, op);
  }

  private async execute(
    op: SwitchOp,
    first: { snapshot: WorkspaceTabs | null; opening: OpeningPlan } | null,
  ): Promise<SwitchResult> {
    for (;;) {
      try {
        switch (op.stage) {
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
      } catch (e) {
        if (op.stage === "snapshot") {
          // Nothing has been touched yet (I2): roll the intent back so the user can retry.
          await this.ctx.repo.remove(Keys.opSwitch(op.windowId)).catch(() => {
            this.mayHavePendingOps = true;
          });
        } else {
          this.mayHavePendingOps = true;
          this.scheduleRetry();
        }
        throw e;
      }
      op.stage = nextStage(op);
      await this.persist(op);
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
    const snap = snapshotWindow({ ...win, tabs }, prev, this.ctx.snapshotOptions());
    const classify = { directSchemes: this.ctx.directSchemes };
    op.outgoingTabIds = tabs
      .filter(
        (t) =>
          !t.pinned && classifyUrl(unwrapUrl(t.url, this.ctx.placeholderBase), classify) !== "skip",
      )
      .map((t) => t.id);
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
    // Adopt placeholders created before a crash but not yet recorded (no duplicates on resume).
    const outgoing = new Set(op.outgoingTabIds);
    const recorded = new Set(Object.values(op.createdTabIds));
    const incomingIds = new Set(op.incoming.map((t) => t.id));
    for (const t of win.tabs) {
      if (outgoing.has(t.id) || recorded.has(t.id)) continue;
      const ph = parsePlaceholderUrl(t.url, this.ctx.placeholderBase);
      if (!ph || ph.w !== op.to || !incomingIds.has(ph.s) || ph.s in op.createdTabIds) continue;
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
          if (spec.savedTabId in op.createdTabIds) continue;
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
        if (progressed) await this.persist(op).catch((err) => this.ctx.log.warn(err));
        throw e;
      }
      if (progressed) await this.persist(op);
      await this.checkpoint(`chunk:${i}`, op);
    }

    for (const g of plan.groups) {
      const ids = g.savedTabIds
        .map((s) => op.createdTabIds[s])
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
    const firstIncoming = op.incoming.map((t) => created[t.id]).find((id) => id !== undefined);
    const target =
      (op.activeSavedTabId !== undefined ? created[op.activeSavedTabId] : undefined) ??
      firstIncoming ??
      created[BLANK_SAVED_TAB_ID];
    if (target !== undefined) {
      try {
        await this.ctx.ports.tabs.update(target, { active: true });
      } catch (e) {
        if (!isNoTabError(e)) throw e;
      }
    }
    await this.ctx.repo.setMany({
      [Keys.window(op.windowId)]: { activeWorkspaceId: op.to, sessionEpoch: this.ctx.epoch },
    });
  }

  /** Removes the outgoing tabs one id at a time (spike S7). Pinned/retained tabs are never listed. */
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
      await this.persist(op);
    }
    const now = ports.now();
    for (const id of op.outgoingTabIds) this.closedBySwitch.set(id, now);
    for (const [id, at] of this.closedBySwitch) {
      if (now - at > CLOSED_BY_SWITCH_TTL) this.closedBySwitch.delete(id);
    }
    await removeTabsSafely(ports.tabs, op.outgoingTabIds);
  }

  /** Full re-snapshot into ws:tabs:<to>, skipped tabs kept as saved links, then commit (delete op). */
  private async stageDone(op: SwitchOp): Promise<SwitchResult> {
    const { repo, ports } = this.ctx;
    const writes: Record<string, unknown> = {};
    const win = await this.ctx.getWindow(op.windowId);
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
    await repo.remove([Keys.opSwitch(op.windowId), Keys.dirty(op.windowId)]);
    if (this.deps.refreshBadge) {
      await this.deps.refreshBadge(op.windowId).catch((e) => this.ctx.log.warn(e));
    }
    return { skipped: op.skipped };
  }

  // ------------------------------------------------------------------ other workspace ops

  /** Window id whose windows:* record has `id` active (and still exists), else null. */
  async ownerOf(id: WorkspaceId): Promise<number | null> {
    const states = await this.ctx.repo.listWindowStates();
    for (const [windowId, st] of states) {
      if (st.activeWorkspaceId !== id) continue;
      if (await this.ctx.getWindow(windowId)) return windowId;
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
    await repo.remove([Keys.wsMeta(id), Keys.wsTabs(id)]);
    for (const w of affected) this.deps.markDirty?.(w);
    return { trashId };
  }

  /** Switches to the next/previous named workspace not open in another window. */
  async nextWorkspace(windowId: number, dir: 1 | -1): Promise<{ workspaceId: WorkspaceId | null }> {
    const { repo } = this.ctx;
    const states = await repo.listWindowStates();
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
