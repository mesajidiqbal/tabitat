/**
 * In-memory fake browser for unit tests. Emulates the Chrome behaviours the spike measured:
 * - `tabs.remove([valid, stale])` removes the valid ids, then rejects "No tab with id: N." (S7);
 * - `tabs.discard` replaces the tab id and fires `tabs.onReplaced` (S11);
 * - closing the last tab of a window closes the window;
 * - storage.session survives a worker kill but not a browser restart.
 *
 * Failure injection: `failNext(op, …)` makes the next matching port call reject.
 * `killWorker()` simulates a service-worker restart: every port handed out before the kill hangs
 * forever (the old worker is gone mid-await) and its event listeners are dropped. Storage and
 * tabs persist; tests then create fresh services from `fake.ports()` and call `ready()` again.
 */
import type { Color } from "../core/model/types";
import type { LiveGroup, LiveTab, LiveWindow } from "../core/ops/types";
import type {
  BgPorts,
  CommandTab,
  EventsPort,
  ShellPort,
  TabChangeInfo,
  TabRemoveInfo,
} from "./events";
import type { StoragePort } from "./types";

export type FailOp =
  | "storage.get"
  | "storage.set"
  | "storage.remove"
  | "session.get"
  | "session.set"
  | "session.remove"
  | "tabs.query"
  | "tabs.get"
  | "tabs.create"
  | "tabs.remove"
  | "tabs.update"
  | "tabs.discard"
  | "tabs.group"
  | "tabs.updateGroup"
  | "windows.getAll"
  | "windows.get"
  | "windows.create"
  | "alarms.create"
  | "alarms.clear"
  | "alarms.getAll";

export interface FailOptions {
  times?: number;
  /** Only calls whose argument matches fail (e.g. storage.set items containing a key). */
  when?: (arg: unknown) => boolean;
  error?: Error;
}

interface FailRule {
  op: FailOp;
  remaining: number;
  when?: (arg: unknown) => boolean;
  error: Error;
}

interface FakeTab {
  id: number;
  windowId: number;
  url: string;
  title: string;
  pinned: boolean;
  active: boolean;
  groupId: number;
  favIconUrl?: string;
  discarded: boolean;
  audible: boolean;
  lastAccessed?: number;
}

interface FakeGroup {
  id: number;
  windowId: number;
  title: string;
  color: Color;
  collapsed: boolean;
}

type EventName =
  | "tabCreated"
  | "tabUpdated"
  | "tabRemoved"
  | "tabMoved"
  | "tabActivated"
  | "tabAttached"
  | "tabDetached"
  | "tabReplaced"
  | "groupUpdated"
  | "windowCreated"
  | "windowRemoved"
  | "alarm"
  | "command"
  | "storage:local"
  | "storage:session";

interface Listener {
  gen: number;
  event: EventName;
  cb: (...args: never[]) => void;
}

export interface TabInit {
  url: string;
  title?: string;
  pinned?: boolean;
  active?: boolean;
  audible?: boolean;
  discarded?: boolean;
  lastAccessed?: number;
  favIconUrl?: string;
}

const NEVER = new Promise<never>(() => {});

export class FakeBrowser {
  readonly extensionId = "fakeextensionid";
  clock = 1_800_000_000_000;
  /** Worker generation; bumped by killWorker(). */
  private gen = 0;
  private nextTab = 100;
  private nextWindow = 1;
  private nextGroup = 500;
  private idSeq = 0;
  private rules: FailRule[] = [];
  private listeners: Listener[] = [];
  private order = new Map<number, number[]>();
  private tabMap = new Map<number, FakeTab>();
  private groupMap = new Map<number, FakeGroup>();
  readonly local = new Map<string, unknown>();
  readonly session = new Map<string, unknown>();
  readonly alarms = new Map<
    string,
    { periodInMinutes?: number; delayInMinutes?: number; when?: number }
  >();
  readonly badges = new Map<number, string>();
  readonly notifications: Array<{ id: string; title: string; message: string }> = [];
  readonly sidePanelOpened: number[] = [];
  popupOpened = 0;
  popupAvailable = true;
  /** Every port call, in order ("tabs.create", …); handy for asserting call sequences. */
  readonly calls: string[] = [];

  // ------------------------------------------------------------------ test controls

  failNext(op: FailOp, opts: number | FailOptions = {}): void {
    const o = typeof opts === "number" ? { times: opts } : opts;
    const rule: FailRule = {
      op,
      remaining: o.times ?? 1,
      error: o.error ?? new Error(`injected failure: ${op}`),
    };
    if (o.when) rule.when = o.when;
    this.rules.push(rule);
  }

  clearFailures(): void {
    this.rules = [];
  }

  /** Simulates a service-worker restart: old ports hang, old listeners are dropped. */
  killWorker(): void {
    this.gen++;
    this.listeners = this.listeners.filter((l) => l.gen === this.gen);
  }

  /**
   * Simulates a browser restart: worker killed, storage.session cleared, alarms cleared, every
   * window/tab/group gets a new id (tabs keep their URLs, as session restore does).
   */
  restartBrowser(): void {
    this.killWorker();
    this.session.clear();
    this.alarms.clear();
    const oldOrder = [...this.order.entries()];
    const oldTabs = this.tabMap;
    const oldGroups = this.groupMap;
    this.order = new Map();
    this.tabMap = new Map();
    this.groupMap = new Map();
    const groupIdMap = new Map<number, number>();
    for (const [, win] of oldOrder) {
      const wid = this.nextWindow++;
      const ids: number[] = [];
      for (const oldId of win) {
        const t = oldTabs.get(oldId) as FakeTab;
        let groupId = -1;
        if (t.groupId !== -1) {
          const og = oldGroups.get(t.groupId);
          if (og) {
            groupId = groupIdMap.get(og.id) ?? this.nextGroup++;
            groupIdMap.set(og.id, groupId);
            this.groupMap.set(groupId, { ...og, id: groupId, windowId: wid });
          }
        }
        const id = this.nextTab++;
        this.tabMap.set(id, { ...t, id, windowId: wid, groupId, discarded: false });
        ids.push(id);
      }
      this.order.set(wid, ids);
    }
  }

  advance(ms: number): void {
    this.clock += ms;
  }

  // ------------------------------------------------------------------ user actions (emit events)

  addWindow(tabs: Array<string | TabInit>, opts: { emit?: boolean } = {}): number {
    const wid = this.nextWindow++;
    this.order.set(wid, []);
    if (opts.emit !== false) this.emit("windowCreated", wid);
    const inits = tabs.map((t) => (typeof t === "string" ? { url: t } : t));
    if (inits.length > 0 && !inits.some((t) => t.active)) {
      const first = inits.findIndex((t) => !t.pinned);
      (inits[first === -1 ? 0 : first] as TabInit).active = true;
    }
    for (const init of inits) this.insertTab(wid, init, undefined, opts.emit !== false);
    return wid;
  }

  openTab(windowId: number, init: string | TabInit): number {
    const i = typeof init === "string" ? { url: init } : init;
    const t = this.insertTab(windowId, i, undefined, true);
    if (i.active) this.activate(t.id);
    return t.id;
  }

  closeTab(tabId: number): void {
    this.removeTab(tabId);
  }

  closeWindow(windowId: number): void {
    const ids = [...(this.order.get(windowId) ?? [])];
    for (const id of ids) {
      const t = this.tabMap.get(id);
      if (!t) continue;
      this.tabMap.delete(id);
      this.emit("tabRemoved", id, { windowId, isWindowClosing: true } satisfies TabRemoveInfo);
    }
    this.order.delete(windowId);
    this.pruneGroups();
    this.emit("windowRemoved", windowId);
  }

  navigate(tabId: number, url: string, title = url): void {
    const t = this.tabMap.get(tabId);
    if (!t) throw new Error(`No tab with id: ${tabId}.`);
    t.url = url;
    t.title = title;
    this.emit("tabUpdated", tabId, { url, title } satisfies TabChangeInfo, this.live(t));
  }

  activate(tabId: number): void {
    const t = this.tabMap.get(tabId);
    if (!t) throw new Error(`No tab with id: ${tabId}.`);
    for (const id of this.order.get(t.windowId) ?? []) {
      const o = this.tabMap.get(id);
      if (o) o.active = o.id === tabId;
    }
    t.lastAccessed = this.clock;
    this.emit("tabActivated", { tabId, windowId: t.windowId });
  }

  fireAlarm(name: string): void {
    this.emit("alarm", name);
  }

  fireCommand(command: string, tab?: CommandTab): void {
    this.emit("command", command, tab);
  }

  // ------------------------------------------------------------------ inspection

  tabsOf(windowId: number): LiveTab[] {
    return (this.order.get(windowId) ?? []).map((id) => this.live(this.tabMap.get(id) as FakeTab));
  }

  urlsOf(windowId: number): string[] {
    return this.tabsOf(windowId).map((t) => t.url);
  }

  windowIds(): number[] {
    return [...this.order.keys()];
  }

  hasTab(tabId: number): boolean {
    return this.tabMap.has(tabId);
  }

  tab(tabId: number): LiveTab | null {
    const t = this.tabMap.get(tabId);
    return t ? this.live(t) : null;
  }

  groupsOf(windowId: number): LiveGroup[] {
    const used = new Set(this.tabsOf(windowId).map((t) => t.groupId));
    return [...this.groupMap.values()]
      .filter((g) => g.windowId === windowId && used.has(g.id))
      .map(({ windowId: _w, ...g }) => ({ ...g }));
  }

  // ------------------------------------------------------------------ ports

  ports(): BgPorts {
    const g = this.gen;
    const gate = <T>(op: FailOp | null, arg: unknown, fn: () => T): Promise<T> => {
      if (g !== this.gen) return NEVER;
      if (op) this.calls.push(op);
      try {
        if (op) this.maybeFail(op, arg);
        return Promise.resolve(fn());
      } catch (e) {
        return Promise.reject(e);
      }
    };
    const storage = (area: "local" | "session"): StoragePort => {
      const map = area === "local" ? this.local : this.session;
      const pfx = area === "local" ? "storage" : "session";
      return {
        get: <T>(key: string) =>
          gate(`${pfx}.get` as FailOp, key, () => clone(map.get(key)) as T | undefined),
        getMany: (keys) =>
          gate(`${pfx}.get` as FailOp, keys, () => {
            const out: Record<string, unknown> = {};
            for (const k of keys) if (map.has(k)) out[k] = clone(map.get(k));
            return out;
          }),
        getAll: () =>
          gate(`${pfx}.get` as FailOp, null, () => {
            const out: Record<string, unknown> = {};
            for (const [k, v] of map) out[k] = clone(v);
            return out;
          }),
        set: (items) =>
          gate(`${pfx}.set` as FailOp, items, () => {
            const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {};
            for (const [k, v] of Object.entries(items)) {
              if (v === undefined) continue;
              changes[k] = { oldValue: clone(map.get(k)), newValue: clone(v) };
              map.set(k, clone(v));
            }
            this.emit(`storage:${area}`, changes);
          }),
        remove: (keys) =>
          gate(`${pfx}.remove` as FailOp, keys, () => {
            const list = typeof keys === "string" ? [keys] : keys;
            const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {};
            for (const k of list) {
              if (!map.has(k)) continue;
              changes[k] = { oldValue: clone(map.get(k)) };
              map.delete(k);
            }
            if (Object.keys(changes).length > 0) this.emit(`storage:${area}`, changes);
          }),
        onChanged: (cb) => this.on(g, `storage:${area}`, cb),
      };
    };

    const events: EventsPort = {
      onTabCreated: (cb) => this.on(g, "tabCreated", cb),
      onTabUpdated: (cb) => this.on(g, "tabUpdated", cb),
      onTabRemoved: (cb) => this.on(g, "tabRemoved", cb),
      onTabMoved: (cb) => this.on(g, "tabMoved", cb),
      onTabActivated: (cb) => this.on(g, "tabActivated", cb),
      onTabAttached: (cb) => this.on(g, "tabAttached", cb),
      onTabDetached: (cb) => this.on(g, "tabDetached", cb),
      onTabReplaced: (cb) => this.on(g, "tabReplaced", cb),
      onGroupUpdated: (cb) => this.on(g, "groupUpdated", cb),
      onWindowCreated: (cb) => this.on(g, "windowCreated", cb),
      onWindowRemoved: (cb) => this.on(g, "windowRemoved", cb),
      onAlarm: (cb) => this.on(g, "alarm", cb),
      onCommand: (cb) => this.on(g, "command", cb),
    };

    const shell: ShellPort = {
      setBadge: (tabId, text) =>
        gate(null, null, () => {
          this.badges.set(tabId, text);
        }),
      notify: (id, title, message) =>
        gate(null, null, () => {
          this.notifications.push({ id, title, message });
        }),
      openPopup: () => {
        if (!this.popupAvailable) return false;
        this.popupOpened++;
        return true;
      },
      openSidePanel: (windowId) => {
        this.sidePanelOpened.push(windowId);
        return true;
      },
    };

    return {
      local: storage("local"),
      session: storage("session"),
      tabs: {
        query: (filter) =>
          gate("tabs.query", filter, () =>
            [...this.order.keys()]
              .flatMap((w) => this.tabsOf(w))
              .filter(
                (t) =>
                  (filter.windowId === undefined || t.windowId === filter.windowId) &&
                  (filter.active === undefined || t.active === filter.active) &&
                  (filter.pinned === undefined || t.pinned === filter.pinned) &&
                  (filter.discarded === undefined || t.discarded === filter.discarded) &&
                  (filter.audible === undefined || t.audible === filter.audible),
              ),
          ),
        get: (tabId) => gate("tabs.get", tabId, () => this.tab(tabId)),
        create: (spec) =>
          gate("tabs.create", spec, () => {
            if (!this.order.has(spec.windowId)) {
              throw new Error(`No window with id: ${spec.windowId}.`);
            }
            const init: TabInit = { url: spec.url, title: "" };
            if (spec.pinned) init.pinned = true;
            const t = this.insertTab(spec.windowId, init, spec.index, true);
            if (spec.active) this.activate(t.id);
            return this.live(t);
          }),
        remove: (tabIds) =>
          gate("tabs.remove", tabIds, () => {
            // Chrome (spike S7): valid ids are removed, then the call rejects on the stale one.
            let stale: number | null = null;
            for (const id of tabIds) {
              if (this.tabMap.has(id)) this.removeTab(id);
              else if (stale === null) stale = id;
            }
            if (stale !== null) throw new Error(`No tab with id: ${stale}.`);
          }),
        update: (tabId, props) =>
          gate("tabs.update", { tabId, ...props }, () => {
            const t = this.tabMap.get(tabId);
            if (!t) throw new Error(`No tab with id: ${tabId}.`);
            if (props.url !== undefined) {
              t.url = props.url;
              this.emit("tabUpdated", tabId, { url: props.url }, this.live(t));
            }
            if (props.pinned !== undefined) {
              t.pinned = props.pinned;
              this.emit("tabUpdated", tabId, { pinned: props.pinned }, this.live(t));
            }
            if (props.active) this.activate(tabId);
          }),
        discard: (tabId) =>
          gate("tabs.discard", tabId, () => {
            const t = this.tabMap.get(tabId);
            if (!t) throw new Error(`No tab with id: ${tabId}.`);
            if (t.active) throw new Error("Cannot discard the active tab");
            // Spike S11: the discarded tab gets a NEW id.
            const id = this.nextTab++;
            this.tabMap.delete(tabId);
            this.tabMap.set(id, { ...t, id, discarded: true });
            const ids = this.order.get(t.windowId) as number[];
            ids[ids.indexOf(tabId)] = id;
            this.emit("tabReplaced", id, tabId);
          }),
        group: (tabIds, windowId) =>
          gate("tabs.group", { tabIds, windowId }, () => {
            const id = this.nextGroup++;
            this.groupMap.set(id, { id, windowId, title: "", color: "grey", collapsed: false });
            for (const tid of tabIds) {
              const t = this.tabMap.get(tid);
              if (!t) throw new Error(`No tab with id: ${tid}.`);
              t.groupId = id;
            }
            this.pruneGroups();
            this.emitGroup(id);
            return id;
          }),
        updateGroup: (groupId, props) =>
          gate("tabs.updateGroup", { groupId, ...props }, () => {
            const grp = this.groupMap.get(groupId);
            if (!grp) throw new Error(`No group with id: ${groupId}.`);
            if (props.title !== undefined) grp.title = props.title;
            if (props.color !== undefined) grp.color = props.color;
            if (props.collapsed !== undefined) grp.collapsed = props.collapsed;
            this.emitGroup(groupId);
          }),
        getGroups: (windowId) => gate(null, windowId, () => this.groupsOf(windowId)),
      },
      windows: {
        getAll: () =>
          gate("windows.getAll", null, () => this.windowIds().map((id) => this.liveWindow(id))),
        get: (windowId) =>
          gate("windows.get", windowId, () =>
            this.order.has(windowId) ? this.liveWindow(windowId) : null,
          ),
        create: (spec) =>
          gate("windows.create", spec, () => {
            const urls =
              spec.url === undefined
                ? ["chrome://newtab/"]
                : Array.isArray(spec.url)
                  ? spec.url
                  : [spec.url];
            const id = this.addWindow(urls);
            return this.liveWindow(id);
          }),
      },
      alarms: {
        create: (name, info) =>
          gate("alarms.create", { name, ...info }, () => {
            this.alarms.set(name, { ...info });
          }),
        clear: (name) =>
          gate("alarms.clear", name, () => {
            this.alarms.delete(name);
          }),
        getAll: () => gate("alarms.getAll", null, () => [...this.alarms.keys()]),
      },
      runtime: {
        id: this.extensionId,
        getURL: (path) => `chrome-extension://${this.extensionId}/${path.replace(/^\//, "")}`,
      },
      now: () => this.clock,
      newId: () => `id-${++this.idSeq}`,
      events,
      shell,
    };
  }

  // ------------------------------------------------------------------ internals

  private maybeFail(op: FailOp, arg: unknown): void {
    const rule = this.rules.find(
      (r) => r.op === op && r.remaining > 0 && (r.when === undefined || r.when(arg)),
    );
    if (!rule) return;
    rule.remaining--;
    this.rules = this.rules.filter((r) => r.remaining > 0);
    throw rule.error;
  }

  private on(gen: number, event: EventName, cb: (...args: never[]) => void): () => void {
    const l: Listener = { gen, event, cb };
    if (gen === this.gen) this.listeners.push(l);
    return () => {
      this.listeners = this.listeners.filter((x) => x !== l);
    };
  }

  private emit(event: EventName, ...args: unknown[]): void {
    for (const l of [...this.listeners]) {
      if (l.event !== event || l.gen !== this.gen) continue;
      (l.cb as (...a: unknown[]) => void)(...args);
    }
  }

  private emitGroup(groupId: number): void {
    const g = this.groupMap.get(groupId);
    if (g) this.emit("groupUpdated", { ...g });
  }

  private live(t: FakeTab): LiveTab {
    const ids = this.order.get(t.windowId) ?? [];
    const out: LiveTab = {
      id: t.id,
      windowId: t.windowId,
      url: t.url,
      title: t.title,
      index: ids.indexOf(t.id),
      pinned: t.pinned,
      active: t.active,
      groupId: t.groupId,
      discarded: t.discarded,
      audible: t.audible,
    };
    if (t.favIconUrl) out.favIconUrl = t.favIconUrl;
    if (t.lastAccessed !== undefined) out.lastAccessed = t.lastAccessed;
    return out;
  }

  private liveWindow(id: number): LiveWindow {
    return { id, tabs: this.tabsOf(id), groups: this.groupsOf(id) };
  }

  private insertTab(windowId: number, init: TabInit, index: number | undefined, emit: boolean) {
    const ids = this.order.get(windowId);
    if (!ids) throw new Error(`No window with id: ${windowId}.`);
    const t: FakeTab = {
      id: this.nextTab++,
      windowId,
      url: init.url,
      title: init.title ?? init.url,
      pinned: init.pinned ?? false,
      active: false,
      groupId: -1,
      discarded: init.discarded ?? false,
      audible: init.audible ?? false,
      lastAccessed: init.lastAccessed ?? this.clock,
    };
    if (init.favIconUrl) t.favIconUrl = init.favIconUrl;
    this.tabMap.set(t.id, t);
    const pinnedCount = ids.filter((id) => this.tabMap.get(id)?.pinned).length;
    let at = index === undefined ? ids.length : Math.min(Math.max(0, index), ids.length);
    if (t.pinned) at = Math.min(at, pinnedCount);
    else at = Math.max(at, pinnedCount);
    ids.splice(at, 0, t.id);
    if (init.active) {
      for (const id of ids) {
        const o = this.tabMap.get(id);
        if (o) o.active = o.id === t.id;
      }
    }
    if (emit) this.emit("tabCreated", this.live(t));
    return t;
  }

  private removeTab(tabId: number): void {
    const t = this.tabMap.get(tabId);
    if (!t) throw new Error(`No tab with id: ${tabId}.`);
    const ids = this.order.get(t.windowId) as number[];
    const lastTab = ids.length === 1;
    this.tabMap.delete(tabId);
    ids.splice(ids.indexOf(tabId), 1);
    if (t.active && ids.length > 0) {
      const next = this.tabMap.get(
        ids[Math.min(ids.length - 1, Math.max(0, ids.length - 1))] as number,
      );
      if (next) next.active = true;
    }
    this.pruneGroups();
    this.emit("tabRemoved", tabId, { windowId: t.windowId, isWindowClosing: lastTab });
    if (lastTab) {
      this.order.delete(t.windowId);
      this.emit("windowRemoved", t.windowId);
    }
  }

  private pruneGroups(): void {
    const used = new Set([...this.tabMap.values()].map((t) => t.groupId));
    for (const id of [...this.groupMap.keys()]) if (!used.has(id)) this.groupMap.delete(id);
  }
}

function clone<T>(v: T): T {
  return v === undefined ? v : structuredClone(v);
}
