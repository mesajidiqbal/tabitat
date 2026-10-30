/**
 * TabTracker (ARCHITECTURE §5.4): auto-saves each window into its active workspace.
 * Events -> markDirty(window) -> 750 ms in-worker debounce (+ durable `dirty:<id>` marker for a
 * killed worker) -> snapshot. Removals flush immediately. Windows with a switch op are skipped
 * (I4). A window without an active workspace gets an implicit Unsorted workspace.
 */

import type { ClosedTab, WorkspaceTabs } from "../core/model/types";
import { Keys, LIMITS } from "../core/model/types";
import { snapshotWindow } from "../core/ops/snapshot";
import type { LiveTab, LiveWindow } from "../core/ops/types";
import { classifyUrl, isDangerousUrl, unwrapUrl } from "../core/ops/url";
import type { TabChangeInfo, TabRemoveInfo, Unsubscribe } from "../platform/events";
import type { BgContext } from "./context";
import { BgKeys, type LastKnownTab } from "./keys";
import { Lane } from "./lanes";

export interface TrackerDeps {
  ready(): Promise<void>;
  isLocked(windowId: number): Promise<boolean>;
  wasClosedBySwitch(tabId: number): boolean;
  onTabReplaced?(added: number, removed: number): Promise<void>;
  /** A window closed while a switch op existed for it. */
  onOrphanedOp?(windowId: number): Promise<void>;
  onWindowGone?(windowId: number): Promise<void>;
  onActivated?(tabId: number, windowId: number): Promise<void>;
  debounceMs?: number;
  maxWaitMs?: number;
}

interface Pending {
  timer: ReturnType<typeof setTimeout>;
  first: number;
}

const SNAPSHOT_FIELDS: ReadonlyArray<keyof TabChangeInfo> = [
  "url",
  "title",
  "pinned",
  "groupId",
  "favIconUrl",
];

/** Recently-closed entries are not worth keeping for these. */
const BORING = /^(chrome|edge|brave):\/\/newtab\/?$|^about:blank$/;

export const flushLanes = (windowId: number): string[] => [Lane.window(windowId), Lane.wsIndex];

export class TabTracker {
  private readonly pending = new Map<number, Pending>();
  /** Windows whose durable dirty marker is written; value = mark counter. */
  private readonly dirty = new Map<number, number>();
  private readonly lastKnown = new Map<number, LastKnownTab & { windowId: number }>();
  private readonly subs: Unsubscribe[] = [];
  private closedChain: Promise<void> = Promise.resolve();
  private readonly debounceMs: number;
  private readonly maxWaitMs: number;

  constructor(
    private readonly ctx: BgContext,
    private readonly deps: TrackerDeps,
  ) {
    this.debounceMs = deps.debounceMs ?? 750;
    this.maxWaitMs = deps.maxWaitMs ?? 5_000;
  }

  /** Registers event listeners synchronously (MV3 top-level rule). */
  start(): void {
    const ev = this.ctx.ports.events;
    const guard =
      <A extends unknown[]>(fn: (...a: A) => Promise<void>) =>
      (...a: A) => {
        void (async () => {
          await this.deps.ready();
          await fn(...a);
        })().catch((e) => this.ctx.log.error("[tabitat] tracker event failed", e));
      };
    this.subs.push(
      ev.onTabCreated(
        guard(async (tab: LiveTab) => {
          this.remember(tab);
          this.markDirty(tab.windowId);
        }),
      ),
      ev.onTabUpdated(
        guard(async (_id: number, change: TabChangeInfo, tab: LiveTab) => {
          this.remember(tab);
          if (SNAPSHOT_FIELDS.some((f) => change[f] !== undefined)) this.markDirty(tab.windowId);
        }),
      ),
      ev.onTabRemoved(guard((id: number, info: TabRemoveInfo) => this.handleRemoved(id, info))),
      ev.onTabMoved(
        guard(async (_id: number, info: { windowId: number }) => this.markDirty(info.windowId)),
      ),
      ev.onTabActivated(
        guard(async (info: { tabId: number; windowId: number }) => {
          this.markDirty(info.windowId);
          await this.deps.onActivated?.(info.tabId, info.windowId);
        }),
      ),
      ev.onTabAttached(
        guard(async (_id: number, info: { newWindowId: number }) =>
          this.markDirty(info.newWindowId),
        ),
      ),
      ev.onTabDetached(
        guard(async (_id: number, info: { oldWindowId: number }) => {
          await this.flush(info.oldWindowId);
        }),
      ),
      ev.onTabReplaced(
        guard((added: number, removed: number) => this.handleReplaced(added, removed)),
      ),
      ev.onGroupUpdated(guard(async (g: { windowId: number }) => this.markDirty(g.windowId))),
      ev.onWindowRemoved(guard((id: number) => this.handleWindowRemoved(id))),
    );
  }

  stop(): void {
    for (const off of this.subs.splice(0)) off();
    for (const p of this.pending.values()) clearTimeout(p.timer);
    this.pending.clear();
  }

  /** Seeds the last-known url/title map (init: from windows.getAll). */
  seed(windows: readonly LiveWindow[]): void {
    for (const w of windows) for (const t of w.tabs) this.remember(t);
  }

  isDirty(windowId: number): boolean {
    return this.dirty.has(windowId) || this.pending.has(windowId);
  }

  dirtyWindows(): number[] {
    return [...new Set([...this.dirty.keys(), ...this.pending.keys()])];
  }

  /** Debounced snapshot request. Writes the durable `dirty:<id>` marker on the first mark. */
  markDirty(windowId: number): void {
    const now = Date.now();
    const prev = this.pending.get(windowId);
    if (prev) clearTimeout(prev.timer);
    const first = prev?.first ?? now;
    const wait = Math.max(0, Math.min(this.debounceMs, first + this.maxWaitMs - now));
    const timer = setTimeout(() => {
      void this.flush(windowId).catch((e) => this.ctx.log.error("[tabitat] flush failed", e));
    }, wait);
    this.pending.set(windowId, { timer, first });
    const count = this.dirty.get(windowId);
    this.dirty.set(windowId, (count ?? 0) + 1);
    if (count === undefined) {
      void this.ctx.repo
        .setMany({ [Keys.dirty(windowId)]: this.ctx.ports.now() })
        .catch((e) => this.ctx.log.warn("[tabitat] dirty marker failed", e));
    }
  }

  /** Snapshots a window now (in its lanes). Clears the dirty marker unless re-marked meanwhile. */
  async flush(windowId: number): Promise<void> {
    const p = this.pending.get(windowId);
    if (p) {
      clearTimeout(p.timer);
      this.pending.delete(windowId);
    }
    const mark = this.dirty.get(windowId);
    await this.ctx.lanes.run(flushLanes(windowId), () => this.snapshotNow(windowId));
    if (this.dirty.get(windowId) === mark && !this.pending.has(windowId)) {
      this.dirty.delete(windowId);
      await this.ctx.repo.remove(Keys.dirty(windowId));
    }
  }

  /** Flushes every window marked dirty in this worker (alarm `flush-dirty`). */
  async flushAll(): Promise<void> {
    for (const id of this.dirtyWindows()) {
      await this.flush(id).catch((e) => this.ctx.log.error("[tabitat] flush failed", id, e));
    }
  }

  /**
   * The snapshot itself. Caller holds lanes window:<id> + key:ws:index.
   * Returns what happened (for tests/diagnostics).
   */
  async snapshotNow(
    windowId: number,
  ): Promise<"locked" | "gone" | "empty" | "created" | "same" | "written"> {
    const { repo } = this.ctx;
    if (await this.deps.isLocked(windowId)) return "locked";
    const win = await this.ctx.getWindow(windowId);
    if (!win) return "gone";
    this.seed([win]);
    await this.writeLastKnown(win);
    const state = await repo.getWindowState(windowId);
    let wsId = state?.activeWorkspaceId ?? null;
    let prev: WorkspaceTabs | null = null;
    if (wsId !== null) {
      const ws = await repo.getWorkspace(wsId);
      if (ws) prev = ws.tabs;
      else wsId = null;
    }
    const snap = snapshotWindow(win, prev, this.ctx.snapshotOptions());
    if (wsId === null) {
      if (snap.tabs.length === 0) return "empty";
      await this.ctx.createUnsorted(windowId, snap);
      return "created";
    }
    if (snap === prev) return "same";
    await repo.setMany({ [Keys.wsTabs(wsId)]: snap });
    return "written";
  }

  // ------------------------------------------------------------------ handlers

  private remember(tab: LiveTab): void {
    if (!tab.url) return;
    const entry: LastKnownTab & { windowId: number } = {
      windowId: tab.windowId,
      url: unwrapUrl(tab.url, this.ctx.placeholderBase),
      title: tab.title,
    };
    if (tab.favIconUrl) entry.favIconUrl = tab.favIconUrl;
    this.lastKnown.set(tab.id, entry);
  }

  private async writeLastKnown(win: LiveWindow): Promise<void> {
    const map: Record<string, LastKnownTab> = {};
    for (const t of win.tabs) {
      const k = this.lastKnown.get(t.id);
      if (k) {
        const { windowId: _w, ...rest } = k;
        map[String(t.id)] = rest;
      }
    }
    await this.ctx.ports.session
      .set({ [BgKeys.lastKnown(win.id)]: map })
      .catch((e) => this.ctx.log.warn("[tabitat] lastKnown cache", e));
  }

  private async lookup(tabId: number, windowId: number): Promise<LastKnownTab | null> {
    const mem = this.lastKnown.get(tabId);
    if (mem) return mem;
    try {
      const cached = await this.ctx.ports.session.get<Record<string, LastKnownTab>>(
        BgKeys.lastKnown(windowId),
      );
      return cached?.[String(tabId)] ?? null;
    } catch {
      return null;
    }
  }

  private async handleRemoved(tabId: number, info: TabRemoveInfo): Promise<void> {
    const known = await this.lookup(tabId, info.windowId);
    this.lastKnown.delete(tabId);
    if (info.isWindowClosing) return; // windows.onRemoved handles the window as a whole
    if (this.deps.wasClosedBySwitch(tabId) || (await this.deps.isLocked(info.windowId))) return;
    if (known) {
      const state = await this.ctx.repo.getWindowState(info.windowId);
      await this.recordClosed([this.closedEntry(known, state?.activeWorkspaceId ?? undefined)]);
    }
    await this.flush(info.windowId);
  }

  private async handleReplaced(added: number, removed: number): Promise<void> {
    const known = this.lastKnown.get(removed);
    if (known) {
      this.lastKnown.delete(removed);
      this.lastKnown.set(added, known);
    }
    await this.deps.onTabReplaced?.(added, removed);
    const tab = await this.ctx.ports.tabs.get(added);
    if (tab) this.markDirty(tab.windowId);
  }

  /**
   * Window closed: its Unsorted workspace's tabs go to recently closed and the Unsorted
   * workspace is moved to the trash; a named workspace stays intact (closed, not deleted).
   */
  async handleWindowRemoved(windowId: number): Promise<void> {
    const p = this.pending.get(windowId);
    if (p) clearTimeout(p.timer);
    this.pending.delete(windowId);
    this.dirty.delete(windowId);
    for (const [id, k] of this.lastKnown) if (k.windowId === windowId) this.lastKnown.delete(id);
    const { repo } = this.ctx;
    await this.ctx.lanes.run([...flushLanes(windowId), Lane.wsMeta, Lane.trash], async () => {
      if (await repo.getOp(windowId)) await this.deps.onOrphanedOp?.(windowId);
      const state = await repo.getWindowState(windowId);
      const removals: string[] = [Keys.window(windowId), Keys.dirty(windowId)];
      const wsId = state?.activeWorkspaceId ?? null;
      if (wsId !== null) {
        const ws = await repo.getWorkspace(wsId);
        if (ws && ws.meta.kind === "unsorted") {
          const closedAt = this.ctx.ports.now();
          const entries = [...ws.tabs.tabs]
            .sort((a, b) => b.index - a.index)
            .map((t) => {
              const e = this.closedEntry(
                {
                  url: t.url,
                  title: t.title,
                  ...(t.favIconUrl ? { favIconUrl: t.favIconUrl } : {}),
                },
                undefined,
              );
              e.closedAt = closedAt;
              return e;
            });
          await this.recordClosed(entries);
          // recentlyClosed is capped, so the whole workspace also goes to the trash (30-day
          // retention, restorable) before it is removed: nothing is dropped silently.
          const index = (await repo.getWorkspaceIndex()).filter((x) => x !== wsId);
          const writes: Record<string, unknown> = { [Keys.wsIndex]: index };
          if (ws.tabs.tabs.length > 0) {
            const trash = await repo.getTrash();
            trash.items.push({
              id: this.ctx.ports.newId(),
              kind: "workspace",
              deletedAt: closedAt,
              meta: ws.meta,
              tabs: ws.tabs,
            });
            writes[Keys.trash] = trash;
          }
          await repo.setMany(writes);
          removals.push(Keys.wsMeta(wsId), Keys.wsTabs(wsId));
        }
      }
      await repo.remove(removals);
    });
    await this.ctx.ports.session.remove(BgKeys.lastKnown(windowId)).catch(() => {});
    await this.deps.onWindowGone?.(windowId);
  }

  private closedEntry(known: LastKnownTab, workspaceId: string | undefined): ClosedTab {
    const entry: ClosedTab = {
      id: this.ctx.ports.newId(),
      url: known.url,
      title: known.title,
      closedAt: this.ctx.ports.now(),
    };
    if (known.favIconUrl && !isDangerousUrl(known.favIconUrl)) entry.favIconUrl = known.favIconUrl;
    if (workspaceId) entry.workspaceId = workspaceId;
    return entry;
  }

  /** Prepends to recentlyClosed (newest first, capped). Serialized within this worker. */
  recordClosed(entries: ClosedTab[]): Promise<void> {
    const keep = entries.filter(
      (e) =>
        e.url !== "" &&
        !BORING.test(e.url) &&
        classifyUrl(e.url, { directSchemes: this.ctx.directSchemes }) !== "skip",
    );
    if (keep.length === 0) return Promise.resolve();
    const run = this.closedChain.then(async () => {
      const list = await this.ctx.repo.getRecentlyClosed();
      const next = [...keep, ...list].slice(0, LIMITS.recentlyClosed);
      await this.ctx.repo.setMany({ [Keys.recentlyClosed]: next });
    });
    this.closedChain = run.catch(() => {});
    return run;
  }
}
