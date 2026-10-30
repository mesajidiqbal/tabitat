/**
 * Real chrome.* implementations of the platform ports. Thin: mapping and error normalisation
 * only; no business logic.
 */
import type { Color } from "../core/model/types";
import type { LiveGroup, LiveTab, LiveWindow } from "../core/ops/types";
import { isNoTabError } from "./errors";
import type { BgPorts, EventsPort, ShellPort, TabChangeInfo } from "./events";
import { liveTabUrl } from "./tab-url";
import type {
  AlarmsPort,
  Ports,
  RuntimePort,
  StoragePort,
  SyncStoragePort,
  TabsPort,
  WindowsPort,
} from "./types";

export function toLiveTab(tab: chrome.tabs.Tab): LiveTab | null {
  if (tab.id === undefined || tab.id < 0) return null;
  const out: LiveTab = {
    id: tab.id,
    windowId: tab.windowId,
    // `url || pendingUrl` (not `??`): a new tab's url is "" until its navigation commits.
    url: liveTabUrl(tab),
    title: tab.title ?? "",
    index: tab.index,
    pinned: tab.pinned,
    active: tab.active,
    groupId: tab.groupId ?? -1,
    discarded: tab.discarded ?? false,
    audible: tab.audible ?? false,
  };
  if (tab.favIconUrl) out.favIconUrl = tab.favIconUrl;
  if (typeof tab.lastAccessed === "number") out.lastAccessed = tab.lastAccessed;
  if (tab.pendingUrl) out.pendingUrl = tab.pendingUrl;
  if (tab.status === "loading" || tab.status === "complete") out.status = tab.status;
  return out;
}

function toLiveTabs(tabs: chrome.tabs.Tab[] | undefined): LiveTab[] {
  const out: LiveTab[] = [];
  for (const t of tabs ?? []) {
    const lt = toLiveTab(t);
    if (lt) out.push(lt);
  }
  return out;
}

function toLiveGroup(g: chrome.tabGroups.TabGroup): LiveGroup {
  return { id: g.id, title: g.title ?? "", color: g.color as Color, collapsed: g.collapsed };
}

export function createStoragePort(area: "local" | "session"): StoragePort {
  const store = () => chrome.storage[area];
  return {
    async get<T>(key: string): Promise<T | undefined> {
      const res = await store().get(key);
      return res[key] as T | undefined;
    },
    async getMany(keys: string[]) {
      if (keys.length === 0) return {};
      return (await store().get(keys)) as Record<string, unknown>;
    },
    async getAll() {
      return (await store().get(null)) as Record<string, unknown>;
    },
    async set(items) {
      await store().set(items);
    },
    async remove(keys) {
      const list = typeof keys === "string" ? [keys] : keys;
      if (list.length === 0) return;
      await store().remove(list);
    },
    onChanged(cb) {
      const listener = (
        changes: Record<string, chrome.storage.StorageChange>,
        areaName: string,
      ): void => {
        if (areaName === area) cb(changes);
      };
      chrome.storage.onChanged.addListener(listener);
      return () => chrome.storage.onChanged.removeListener(listener);
    },
  };
}

/** Chrome's documented per-item limit, used when the API does not expose it. */
const DEFAULT_SYNC_QUOTA_PER_ITEM = 8192;

export function createSyncStoragePort(): SyncStoragePort {
  const area = (): chrome.storage.SyncStorageArea | undefined =>
    (chrome.storage as { sync?: chrome.storage.SyncStorageArea } | undefined)?.sync;
  const need = (): chrome.storage.SyncStorageArea => {
    const a = area();
    if (!a) throw new Error("storage.sync is unavailable");
    return a;
  };
  return {
    get available() {
      return area() !== undefined;
    },
    get QUOTA_BYTES_PER_ITEM() {
      return area()?.QUOTA_BYTES_PER_ITEM ?? DEFAULT_SYNC_QUOTA_PER_ITEM;
    },
    async get<T>(key: string): Promise<T | undefined> {
      const res = await need().get(key);
      return res[key] as T | undefined;
    },
    async set(items) {
      await need().set(items);
    },
    async remove(keys) {
      const list = typeof keys === "string" ? [keys] : keys;
      if (list.length === 0) return;
      await need().remove(list);
    },
    onChanged(cb) {
      const listener = (
        changes: Record<string, chrome.storage.StorageChange>,
        areaName: string,
      ): void => {
        if (areaName === "sync") cb(changes);
      };
      if (!chrome.storage?.onChanged) return () => {};
      chrome.storage.onChanged.addListener(listener);
      return () => chrome.storage.onChanged.removeListener(listener);
    },
  };
}

async function groupsOf(windowId: number): Promise<LiveGroup[]> {
  try {
    return (await chrome.tabGroups.query({ windowId })).map(toLiveGroup);
  } catch {
    return [];
  }
}

export function createTabsPort(): TabsPort {
  return {
    async query(filter) {
      return toLiveTabs(await chrome.tabs.query({ ...filter, windowType: "normal" }));
    },
    async get(tabId) {
      try {
        return toLiveTab(await chrome.tabs.get(tabId));
      } catch {
        return null;
      }
    },
    async create(spec) {
      const props: chrome.tabs.CreateProperties = {
        windowId: spec.windowId,
        url: spec.url,
        active: spec.active,
      };
      if (spec.index !== undefined) props.index = spec.index;
      if (spec.pinned !== undefined) props.pinned = spec.pinned;
      const tab = toLiveTab(await chrome.tabs.create(props));
      if (!tab) throw new Error("tabs.create returned a tab without id");
      return tab;
    },
    async remove(tabIds) {
      // Spike S7: a batched remove rejects on a stale id after removing the valid ones.
      for (const id of tabIds) {
        try {
          await chrome.tabs.remove(id);
        } catch (e) {
          if (!isNoTabError(e)) throw e;
        }
      }
    },
    async update(tabId, props) {
      await chrome.tabs.update(tabId, props);
    },
    async discard(tabId) {
      // The returned tab has a NEW id (spike S11); TabTracker follows tabs.onReplaced.
      await chrome.tabs.discard(tabId);
    },
    async group(tabIds, windowId) {
      return chrome.tabs.group({
        tabIds: tabIds as [number, ...number[]],
        createProperties: { windowId },
      });
    },
    async updateGroup(groupId, props) {
      await chrome.tabGroups.update(groupId, props as chrome.tabGroups.UpdateProperties);
    },
    getGroups: groupsOf,
  };
}

async function toLiveWindow(w: chrome.windows.Window): Promise<LiveWindow | null> {
  if (w.id === undefined) return null;
  return { id: w.id, tabs: toLiveTabs(w.tabs), groups: await groupsOf(w.id) };
}

export function createWindowsPort(): WindowsPort {
  return {
    async getAll() {
      const wins = await chrome.windows.getAll({ populate: true, windowTypes: ["normal"] });
      const out: LiveWindow[] = [];
      for (const w of wins) {
        const lw = await toLiveWindow(w);
        if (lw) out.push(lw);
      }
      return out;
    },
    async get(windowId) {
      try {
        const w = await chrome.windows.get(windowId, { populate: true });
        if (w.type && w.type !== "normal") return null;
        return await toLiveWindow(w);
      } catch {
        return null;
      }
    },
    async create(spec) {
      const props: chrome.windows.CreateData = { type: "normal" };
      if (spec.url !== undefined) props.url = spec.url;
      if (spec.focused !== undefined) props.focused = spec.focused;
      const w = await chrome.windows.create(props);
      if (!w || w.id === undefined) throw new Error("windows.create returned no window");
      return { id: w.id, tabs: toLiveTabs(w.tabs), groups: [] };
    },
  };
}

export function createAlarmsPort(): AlarmsPort {
  return {
    async create(name, info) {
      // Spike S5: Chrome only clamps to 30 s on packaged installs; never ask for less.
      const safe = { ...info };
      if (safe.periodInMinutes !== undefined)
        safe.periodInMinutes = Math.max(0.5, safe.periodInMinutes);
      if (safe.delayInMinutes !== undefined)
        safe.delayInMinutes = Math.max(0.5, safe.delayInMinutes);
      if (safe.when !== undefined) safe.when = Math.max(Date.now() + 30_000, safe.when);
      await chrome.alarms.create(name, safe as chrome.alarms.AlarmCreateInfo);
    },
    async clear(name) {
      await chrome.alarms.clear(name);
    },
    async getAll() {
      return (await chrome.alarms.getAll()).map((a) => a.name);
    },
  };
}

export function createRuntimePort(): RuntimePort {
  return {
    getURL: (path) => chrome.runtime.getURL(path),
    id: chrome.runtime.id,
  };
}

export function createChromePorts(): Ports {
  return {
    local: createStoragePort("local"),
    session: createStoragePort("session"),
    sync: createSyncStoragePort(),
    tabs: createTabsPort(),
    windows: createWindowsPort(),
    alarms: createAlarmsPort(),
    runtime: createRuntimePort(),
    now: () => Date.now(),
    newId: () => crypto.randomUUID(),
  };
}

type AnyListener = (...args: never[]) => void;
interface ChromeEvent<L extends AnyListener> {
  addListener(cb: L, ...rest: never[]): void;
  removeListener(cb: L): void;
}

function sub<L extends AnyListener>(ev: ChromeEvent<L>, cb: L, ...rest: never[]): () => void {
  ev.addListener(cb, ...rest);
  return () => ev.removeListener(cb);
}

export function createChromeEvents(): EventsPort {
  const groupCb =
    (cb: Parameters<EventsPort["onGroupUpdated"]>[0]) => (g: chrome.tabGroups.TabGroup) =>
      cb({ ...toLiveGroup(g), windowId: g.windowId });
  return {
    onTabCreated: (cb) =>
      sub(chrome.tabs.onCreated, (t: chrome.tabs.Tab) => {
        const lt = toLiveTab(t);
        if (lt) cb(lt);
      }),
    onTabUpdated: (cb) =>
      sub(
        chrome.tabs.onUpdated,
        (id: number, change: chrome.tabs.OnUpdatedInfo, t: chrome.tabs.Tab) => {
          const lt = toLiveTab(t);
          if (lt) cb(id, change as TabChangeInfo, lt);
        },
      ),
    onTabRemoved: (cb) =>
      sub(chrome.tabs.onRemoved, (id: number, info: chrome.tabs.OnRemovedInfo) =>
        cb(id, { windowId: info.windowId, isWindowClosing: info.isWindowClosing }),
      ),
    onTabMoved: (cb) =>
      sub(chrome.tabs.onMoved, (id: number, info: chrome.tabs.OnMovedInfo) =>
        cb(id, { windowId: info.windowId }),
      ),
    onTabActivated: (cb) =>
      sub(chrome.tabs.onActivated, (info: chrome.tabs.OnActivatedInfo) =>
        cb({ tabId: info.tabId, windowId: info.windowId }),
      ),
    onTabAttached: (cb) =>
      sub(chrome.tabs.onAttached, (id: number, info: chrome.tabs.OnAttachedInfo) =>
        cb(id, { newWindowId: info.newWindowId }),
      ),
    onTabDetached: (cb) =>
      sub(chrome.tabs.onDetached, (id: number, info: chrome.tabs.OnDetachedInfo) =>
        cb(id, { oldWindowId: info.oldWindowId }),
      ),
    onTabReplaced: (cb) => sub(chrome.tabs.onReplaced, (a: number, r: number) => cb(a, r)),
    onGroupUpdated: (cb) => {
      const l = groupCb(cb);
      const offs = [
        sub(chrome.tabGroups.onCreated, l),
        sub(chrome.tabGroups.onUpdated, l),
        sub(chrome.tabGroups.onMoved, l),
        sub(chrome.tabGroups.onRemoved, l),
      ];
      return () => {
        for (const off of offs) off();
      };
    },
    onWindowCreated: (cb) =>
      sub(chrome.windows.onCreated, (w: chrome.windows.Window) => {
        if (w.id !== undefined && (!w.type || w.type === "normal")) cb(w.id);
      }),
    onWindowRemoved: (cb) => sub(chrome.windows.onRemoved, (id: number) => cb(id)),
    onAlarm: (cb) => sub(chrome.alarms.onAlarm, (a: chrome.alarms.Alarm) => cb(a.name)),
    onCommand: (cb) =>
      sub(chrome.commands.onCommand, (command: string, tab?: chrome.tabs.Tab) =>
        cb(command, tab ? { id: tab.id, windowId: tab.windowId } : undefined),
      ),
  };
}

const BADGE_COLORS: Record<Color, string> = {
  grey: "#5f6368",
  blue: "#1a73e8",
  red: "#d93025",
  yellow: "#f9ab00",
  green: "#188038",
  pink: "#d01884",
  purple: "#a142f4",
  cyan: "#007b83",
  orange: "#fa903e",
};

export function createChromeShell(): ShellPort {
  return {
    async setBadge(tabId, text, color) {
      await chrome.action.setBadgeText({ tabId, text });
      if (color) {
        await chrome.action.setBadgeBackgroundColor({
          tabId,
          color: BADGE_COLORS[color as Color] ?? color,
        });
      }
    },
    async notify(id, title, message) {
      await chrome.notifications.create(id, {
        type: "basic",
        iconUrl: chrome.runtime.getURL("/icon/128.png"),
        title,
        message,
      });
    },
    openPopup() {
      if (typeof chrome.action?.openPopup !== "function") return false;
      chrome.action.openPopup().catch((e: unknown) => console.warn("[tabitat] openPopup", e));
      return true;
    },
    openSidePanel(windowId) {
      if (typeof chrome.sidePanel?.open !== "function") return false;
      // Called synchronously from the gesture handler; never awaited before the call.
      chrome.sidePanel
        .open({ windowId })
        .catch((e: unknown) => console.warn("[tabitat] sidePanel.open", e));
      return true;
    },
  };
}

export function createChromeBgPorts(): BgPorts {
  return { ...createChromePorts(), events: createChromeEvents(), shell: createChromeShell() };
}
