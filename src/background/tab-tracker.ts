/**
 * TabTracker (ARCHITECTURE §5.4): auto-saves each window into its active workspace.
 * Events -> markDirty(window) -> 750 ms in-worker debounce (+ durable `dirty:<id>` marker for a
 * killed worker) -> snapshot. Removals flush immediately. Windows with a switch op are skipped
 * (I4). A window without an active workspace gets an implicit Unsorted workspace.
 *
 * Every tab/group event also updates a last-known copy of the window (`lk:<windowId>` in
 * storage.session). When a window closes it can no longer be queried, so `windows.onRemoved`
 * snapshots that copy: changes made within the debounce window before a close are not lost.
 */

import type { ClosedTab, WindowState, WorkspaceMeta, WorkspaceTabs } from "../core/model/types";
import { Keys, LIMITS, PROVISIONAL_MS } from "../core/model/types";
import { type SnapshotOptions, snapshotWindow } from "../core/ops/snapshot";
import type { LiveGroup, LiveTab, LiveWindow } from "../core/ops/types";
import {
  captureUrl,
  classifyUrl,
  parsePlaceholderUrl,
  sanitizeFavIconUrl,
  unwrapUrl,
} from "../core/ops/url";
import type { TabChangeInfo, TabRemoveInfo, Unsubscribe } from "../platform/events";
import type { BgContext } from "./context";
import { BG_PREFIX, BgKeys, type LastKnownWindow } from "./keys";
import { Lane } from "./lanes";
import type { ReadyState } from "./ready";

export interface TrackerDeps {
  /** Init barrier; a degraded worker does not track (it must not write). */
  ready(): Promise<ReadyState | undefined>;
  isLocked(windowId: number): Promise<boolean>;
  wasClosedBySwitch(tabId: number, windowId: number): boolean | Promise<boolean>;
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

interface LkWindow {
  tabs: Map<number, LiveTab>;
  groups: Map<number, LiveGroup>;
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

/** The minimal LiveTab kept in the last-known map. */
function minimalTab(t: LiveTab): LiveTab {
  const out: LiveTab = {
    id: t.id,
    windowId: t.windowId,
    url: t.url,
    title: t.title,
    index: t.index,
    pinned: t.pinned,
    active: t.active,
    groupId: t.groupId,
    discarded: t.discarded,
    audible: false,
  };
  if (t.favIconUrl) out.favIconUrl = t.favIconUrl;
  if (t.pendingUrl) out.pendingUrl = t.pendingUrl;
  if (t.status) out.status = t.status;
  return out;
}

export class TabTracker {
  private readonly pending = new Map<number, Pending>();
  /** Windows whose durable dirty marker is written; value = mark counter. */
  private readonly dirty = new Map<number, number>();
  /** Last-known tabs/groups per window (mirrored to storage.session `lk:<windowId>`). */
  private readonly lk = new Map<number, LkWindow>();
  private readonly lkDirty = new Set<number>();
  /**
   * Tabs a previous worker knew that were gone when this worker started (their removal event
   * may still be on its way): looked up for recently-closed entries.
   */
  private readonly ghosts = new Map<number, LiveTab>();
  private lkWriting: Promise<void> | null = null;
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
          const st = await this.deps.ready();
          if (st?.degraded) return; // init failed: never write on an unknown state
          await fn(...a);
        })().catch((e) => this.ctx.log.error("[tabitat] tracker event failed", e));
      };
    this.subs.push(
      ev.onTabCreated(
        guard(async (tab: LiveTab) => {
          this.lkUpsert(tab, true);
          this.markDirty(tab.windowId);
        }),
      ),
      ev.onTabUpdated(
        guard(async (_id: number, change: TabChangeInfo, tab: LiveTab) => {
          this.lkUpsert(tab, false);
          const pendingNav = change.status === "loading" && tab.pendingUrl !== undefined;
          if (pendingNav || SNAPSHOT_FIELDS.some((f) => change[f] !== undefined)) {
            this.markDirty(tab.windowId);
          }
        }),
      ),
      ev.onTabRemoved(guard((id: number, info: TabRemoveInfo) => this.handleRemoved(id, info))),
      ev.onTabMoved(
        guard(async (_id: number, info: { windowId: number }) => {
          await this.refreshLk(info.windowId);
          this.markDirty(info.windowId);
        }),
      ),
      ev.onTabActivated(
        guard(async (info: { tabId: number; windowId: number }) => {
          this.lkActivate(info.windowId, info.tabId);
          this.markDirty(info.windowId);
          await this.deps.onActivated?.(info.tabId, info.windowId);
        }),
      ),
      ev.onTabAttached(
        guard(async (_id: number, info: { newWindowId: number }) => {
          await this.refreshLk(info.newWindowId);
          this.markDirty(info.newWindowId);
        }),
      ),
      ev.onTabDetached(
        guard(async (id: number, info: { oldWindowId: number }) => {
          this.lkDelete(info.oldWindowId, id);
          await this.flush(info.oldWindowId);
        }),
      ),
      ev.onTabReplaced(
        guard((added: number, removed: number) => this.handleReplaced(added, removed)),
      ),
      ev.onGroupUpdated(
        guard(async (g: LiveGroup & { windowId: number }) => {
          const w = this.lkWindow(g.windowId);
          w.groups.set(g.id, { id: g.id, title: g.title, color: g.color, collapsed: g.collapsed });
          this.scheduleLkWrite(g.windowId);
          this.markDirty(g.windowId);
        }),
      ),
      ev.onWindowRemoved(guard((id: number) => this.handleWindowRemoved(id))),
    );
  }

  stop(): void {
    for (const off of this.subs.splice(0)) off();
    for (const p of this.pending.values()) clearTimeout(p.timer);
    this.pending.clear();
  }

  /** Replaces the last-known copy of each window (init: from windows.getAll; snapshots). */
  seed(windows: readonly LiveWindow[]): void {
    for (const w of windows) {
      const entry: LkWindow = { tabs: new Map(), groups: new Map() };
      for (const t of w.tabs) entry.tabs.set(t.id, minimalTab(t));
      for (const g of w.groups) entry.groups.set(g.id, { ...g });
      this.lk.set(w.id, entry);
      this.scheduleLkWrite(w.id);
    }
  }

  /**
   * Init, before `seed`: keeps what the previous worker knew about tabs that are already gone
   * (a removal that woke this worker is processed after init has re-seeded from the live state).
   */
  async adoptSessionCache(windows: readonly LiveWindow[]): Promise<void> {
    const liveTabs = new Set(windows.flatMap((w) => w.tabs.map((t) => t.id)));
    for (const w of windows) {
      try {
        const cached = await this.ctx.ports.session.get<LastKnownWindow>(BgKeys.lk(w.id));
        for (const t of cached?.tabs ?? []) if (!liveTabs.has(t.id)) this.ghosts.set(t.id, t);
      } catch {
        // cache unavailable: nothing to adopt
      }
    }
  }

  /**
   * Windows this worker never saw close: a last-known copy exists in storage.session but the
   * window is not live (the worker was dead when it closed; its close event may still be on its
   * way). Init handles them before reconciliation prunes their windows:* records.
   */
  async closedWhileAway(live: ReadonlySet<number>): Promise<number[]> {
    try {
      return Object.keys(await this.ctx.ports.session.getAll())
        .filter((k) => k.startsWith(BG_PREFIX.lk))
        .map((k) => Number(k.slice(BG_PREFIX.lk.length)))
        .filter((id) => Number.isInteger(id) && !live.has(id));
    } catch {
      return [];
    }
  }

  /** Resolves once every pending last-known write has been issued (tests, diagnostics). */
  async lkSettled(): Promise<void> {
    while (this.lkWriting) await this.lkWriting;
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
    const res = await this.ctx.lanes.run(flushLanes(windowId), () => this.snapshotNow(windowId));
    if (this.dirty.get(windowId) === mark && !this.pending.has(windowId)) {
      this.dirty.delete(windowId);
      // A window that is gone is handled by windows.onRemoved / reconcile, not here.
      if (res !== "locked") await this.ctx.repo.remove(Keys.dirty(windowId));
    }
  }

  /**
   * Flushes every dirty window: those marked in this worker AND every durable `dirty:<id>`
   * marker in storage.local (a previous worker's leftovers; alarm `flush-dirty`). Markers of
   * windows that no longer exist are removed.
   */
  async flushAll(): Promise<void> {
    const durable = Object.keys(await this.ctx.repo.listRaw("dirty:"))
      .map((k) => Number(k.slice("dirty:".length)))
      .filter((id) => Number.isInteger(id));
    const live = new Set((await this.ctx.ports.windows.getAll()).map((w) => w.id));
    const stale = durable.filter((id) => !live.has(id) && !this.lk.has(id));
    if (stale.length > 0) await this.ctx.repo.remove(stale.map((id) => Keys.dirty(id)));
    const ids = new Set([...this.dirtyWindows(), ...durable.filter((id) => live.has(id))]);
    for (const id of ids) {
      await this.flush(id).catch((e) => this.ctx.log.error("[tabitat] flush failed", id, e));
    }
  }

  /**
   * Snapshot options for a window whose active workspace is `wsId` (named): placeholders of
   * another workspace that are still saved there belong to an interrupted switch and are not
   * absorbed (review L).
   */
  private async snapshotOptsFor(
    win: LiveWindow,
    wsId: string | null,
    meta: WorkspaceMeta | null,
  ): Promise<SnapshotOptions> {
    const opts = this.ctx.snapshotOptions();
    if (wsId === null || meta?.kind !== "named") return opts;
    const foreign = new Set<string>();
    for (const t of win.tabs) {
      const ph = parsePlaceholderUrl(captureUrl(t), this.ctx.placeholderBase);
      if (ph && ph.w !== wsId) foreign.add(ph.w);
    }
    if (foreign.size === 0) return opts;
    const saved = new Map<string, Set<string>>();
    for (const w of foreign) {
      const tabs = await this.ctx.repo.getWorkspaceTabs(w).catch(() => null);
      saved.set(w, new Set(tabs?.tabs.map((t) => t.id) ?? []));
    }
    return {
      ...opts,
      excludeForeignPlaceholders: {
        activeWorkspaceId: wsId,
        isSavedElsewhere: (w, s) => saved.get(w)?.has(s) === true,
      },
    };
  }

  /**
   * The snapshot itself. Caller holds lanes window:<id> + key:ws:index.
   * Returns what happened (for tests/diagnostics).
   */
  async snapshotNow(
    windowId: number,
  ): Promise<"locked" | "gone" | "empty" | "created" | "same" | "written"> {
    const { repo, ports } = this.ctx;
    if (await this.deps.isLocked(windowId)) return "locked";
    const win = await this.ctx.getWindow(windowId);
    if (!win) return "gone";
    this.seed([win]);
    const state = await repo.getWindowState(windowId);
    let wsId = state?.activeWorkspaceId ?? null;
    let prev: WorkspaceTabs | null = null;
    let meta: WorkspaceMeta | null = null;
    if (wsId !== null) {
      const ws = await repo.getWorkspace(wsId);
      if (ws) {
        prev = ws.tabs;
        meta = ws.meta;
      } else wsId = null;
    }
    const snap = snapshotWindow(win, prev, await this.snapshotOptsFor(win, wsId, meta));
    if (wsId === null) {
      if (snap.tabs.length === 0) return "empty";
      await this.ctx.createUnsorted(windowId, snap);
      return "created";
    }
    const writes: Record<string, unknown> = {};
    if (state?.provisional) {
      // Provisional (heuristic) match: the pre-reconciliation tabs stay under ws:prev:<id>.
      if (prev && !(await repo.getWorkspacePrev(wsId))) {
        writes[Keys.wsPrev(wsId)] = { tabs: prev, savedAt: ports.now() };
      }
      if (ports.now() - (state.provisionalAt ?? 0) >= PROVISIONAL_MS) {
        writes[Keys.window(windowId)] = {
          activeWorkspaceId: wsId,
          sessionEpoch: state.sessionEpoch,
        } satisfies WindowState;
      }
    }
    if (snap !== prev) writes[Keys.wsTabs(wsId)] = snap;
    if (Object.keys(writes).length === 0) return "same";
    await repo.setMany(writes);
    return snap === prev ? "same" : "written";
  }

  // ------------------------------------------------------------------ last-known windows

  private lkWindow(windowId: number): LkWindow {
    let w = this.lk.get(windowId);
    if (!w) {
      w = { tabs: new Map(), groups: new Map() };
      this.lk.set(windowId, w);
    }
    return w;
  }

  private lkUpsert(tab: LiveTab, created: boolean): void {
    const w = this.lkWindow(tab.windowId);
    if (created) {
      for (const t of w.tabs.values()) if (t.index >= tab.index) t.index++;
    }
    w.tabs.set(tab.id, minimalTab(tab));
    this.scheduleLkWrite(tab.windowId);
  }

  private lkDelete(windowId: number, tabId: number): void {
    const w = this.lk.get(windowId);
    const gone = w?.tabs.get(tabId);
    if (!w || !gone) return;
    w.tabs.delete(tabId);
    for (const t of w.tabs.values()) if (t.index > gone.index) t.index--;
    this.scheduleLkWrite(windowId);
  }

  private lkActivate(windowId: number, tabId: number): void {
    const w = this.lk.get(windowId);
    if (!w) return;
    for (const t of w.tabs.values()) t.active = t.id === tabId;
    this.scheduleLkWrite(windowId);
  }

  /** Re-reads a window (moves/attaches change indices we are not told about). */
  private async refreshLk(windowId: number): Promise<void> {
    const win = await this.ctx.getWindow(windowId).catch(() => null);
    if (win) this.seed([win]);
  }

  private scheduleLkWrite(windowId: number): void {
    this.lkDirty.add(windowId);
    if (!this.lkWriting) {
      this.lkWriting = this.drainLk().finally(() => {
        this.lkWriting = null;
      });
    }
  }

  /** Coalesced storage.session writes of the last-known map (in event order per window). */
  private async drainLk(): Promise<void> {
    while (this.lkDirty.size > 0) {
      const items: Record<string, unknown> = {};
      for (const id of [...this.lkDirty]) {
        this.lkDirty.delete(id);
        const w = this.lk.get(id);
        if (w) items[BgKeys.lk(id)] = this.lkValue(w);
      }
      if (Object.keys(items).length === 0) continue;
      await this.ctx.ports.session
        .set(items)
        .catch((e) => this.ctx.log.warn("[tabitat] last-known cache", e));
    }
  }

  private lkValue(w: LkWindow): LastKnownWindow {
    return {
      tabs: [...w.tabs.values()].sort((a, b) => a.index - b.index),
      groups: [...w.groups.values()],
    };
  }

  /** The window's last-known state: this worker's copy, else storage.session (worker restart). */
  private async lastKnownWindow(windowId: number): Promise<LiveWindow | null> {
    const mem = this.lk.get(windowId);
    if (mem && mem.tabs.size > 0) return { id: windowId, ...this.lkValue(mem) };
    try {
      const cached = await this.ctx.ports.session.get<LastKnownWindow>(BgKeys.lk(windowId));
      if (cached && Array.isArray(cached.tabs) && cached.tabs.length > 0) {
        return { id: windowId, tabs: cached.tabs, groups: cached.groups ?? [] };
      }
    } catch {
      // fall through
    }
    return null;
  }

  private async lookup(tabId: number, windowId: number): Promise<LiveTab | null> {
    const mem = this.lk.get(windowId)?.tabs.get(tabId) ?? this.ghosts.get(tabId);
    if (mem) {
      this.ghosts.delete(tabId);
      return mem;
    }
    return (await this.lastKnownWindow(windowId))?.tabs.find((t) => t.id === tabId) ?? null;
  }

  // ------------------------------------------------------------------ handlers

  private async handleRemoved(tabId: number, info: TabRemoveInfo): Promise<void> {
    if (info.isWindowClosing) {
      // No debounce: windows.onRemoved snapshots the last-known copy (kept as it is) right away.
      const p = this.pending.get(info.windowId);
      if (p) clearTimeout(p.timer);
      this.pending.delete(info.windowId);
      return;
    }
    const known = await this.lookup(tabId, info.windowId);
    this.lkDelete(info.windowId, tabId);
    if (
      (await this.deps.wasClosedBySwitch(tabId, info.windowId)) ||
      (await this.deps.isLocked(info.windowId))
    ) {
      return;
    }
    if (known) {
      const state = await this.ctx.repo.getWindowState(info.windowId);
      await this.recordClosed([this.closedEntry(known, state?.activeWorkspaceId ?? undefined)]);
    }
    await this.flush(info.windowId);
  }

  private async handleReplaced(added: number, removed: number): Promise<void> {
    for (const [windowId, w] of this.lk) {
      const t = w.tabs.get(removed);
      if (!t) continue;
      w.tabs.delete(removed);
      w.tabs.set(added, { ...t, id: added, discarded: true });
      this.scheduleLkWrite(windowId);
    }
    await this.deps.onTabReplaced?.(added, removed);
    const tab = await this.ctx.ports.tabs.get(added);
    if (tab) this.markDirty(tab.windowId);
  }

  /**
   * Window closed. Its last-known contents (it can no longer be queried) are snapshotted into
   * its workspace: a named workspace keeps them (closed, not deleted); an Unsorted workspace's
   * tabs go to recently closed and the workspace to the trash.
   */
  async handleWindowRemoved(windowId: number): Promise<void> {
    const p = this.pending.get(windowId);
    if (p) clearTimeout(p.timer);
    this.pending.delete(windowId);
    this.dirty.delete(windowId);
    const last = await this.lastKnownWindow(windowId);
    this.lk.delete(windowId);
    this.lkDirty.delete(windowId);
    const { repo, ports } = this.ctx;
    await this.ctx.lanes.run([...flushLanes(windowId), Lane.wsMeta, Lane.trash], async () => {
      if (await repo.getOp(windowId)) await this.deps.onOrphanedOp?.(windowId);
      const state = await repo.getWindowState(windowId);
      const removals: string[] = [Keys.window(windowId), Keys.dirty(windowId)];
      let wsId = state?.activeWorkspaceId ?? null;
      const ws = wsId !== null ? await repo.getWorkspace(wsId) : null;
      if (!ws) wsId = null;
      const snap =
        last !== null
          ? snapshotWindow(
              last,
              ws?.tabs ?? null,
              await this.snapshotOptsFor(last, wsId, ws?.meta ?? null),
            )
          : null;
      const writes: Record<string, unknown> = {};
      if (ws && wsId !== null && ws.meta.kind === "named") {
        // Never overwrite saved tabs with an empty copy (no last-known info).
        if (snap && snap !== ws.tabs && snap.tabs.length > 0) writes[Keys.wsTabs(wsId)] = snap;
      } else {
        const tabs = snap ?? ws?.tabs ?? null;
        const closedAt = ports.now();
        if (tabs && tabs.tabs.length > 0) {
          const entries = [...tabs.tabs]
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
          // recentlyClosed is capped, so the whole set also goes to the trash (30-day retention,
          // restorable) before anything is removed: nothing is dropped silently.
          const trash = await repo.getTrash();
          trash.items.push({
            id: ports.newId(),
            kind: "workspace",
            deletedAt: closedAt,
            meta: ws?.meta ?? this.closedWindowMeta(windowId, closedAt),
            tabs,
          });
          writes[Keys.trash] = trash;
        }
        if (ws && wsId !== null) {
          writes[Keys.wsIndex] = (await repo.getWorkspaceIndex()).filter((x) => x !== wsId);
          removals.push(Keys.wsMeta(wsId), Keys.wsTabs(wsId));
        }
      }
      if (Object.keys(writes).length > 0) await repo.setMany(writes);
      await repo.remove(removals);
    });
    await this.ctx.ports.session.remove(BgKeys.lk(windowId)).catch(() => {});
    await this.deps.onWindowGone?.(windowId);
  }

  private closedWindowMeta(windowId: number, now: number): WorkspaceMeta {
    return {
      id: this.ctx.ports.newId(),
      name: `Closed window ${windowId}`,
      color: "grey",
      kind: "unsorted",
      resources: [],
      createdAt: now,
      updatedAt: now,
      rev: 1,
    };
  }

  private closedEntry(
    known: { url: string; title: string; favIconUrl?: string; pendingUrl?: string },
    workspaceId: string | undefined,
  ): ClosedTab {
    const raw = captureUrl(known);
    const ph = parsePlaceholderUrl(raw, this.ctx.placeholderBase);
    const entry: ClosedTab = {
      id: this.ctx.ports.newId(),
      url: unwrapUrl(raw, this.ctx.placeholderBase),
      title: ph ? ph.t || known.title : known.title,
      closedAt: this.ctx.ports.now(),
    };
    const favIconUrl = ph ? undefined : sanitizeFavIconUrl(known.favIconUrl);
    if (favIconUrl) entry.favIconUrl = favIconUrl;
    if (workspaceId) entry.workspaceId = workspaceId;
    return entry;
  }

  /** Prepends to recentlyClosed (newest first, capped). Serialized within this worker. */
  recordClosed(entries: ClosedTab[]): Promise<void> {
    const keep = entries.filter(
      (e) =>
        e.url !== "" &&
        !BORING.test(e.url) &&
        classifyUrl(e.url, this.ctx.classifyOptions()) !== "skip",
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
