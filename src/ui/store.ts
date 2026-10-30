/**
 * Signals read model shared by popup, side panel and recovery (UI-SPEC "Shared read model").
 * Reads: storage.local (one get at start + one onChanged listener) and chrome.tabs/tabGroups for
 * the current window's live tabs. Never writes storage: every mutation goes through `send()`
 * (ADR-003). `initStore()` sets up all subscriptions once per page; `useStore()` calls it.
 */
import { batch, computed, effect, type Signal, signal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import type { RecoveryPending } from "@/background/keys";
import type {
  ClosedTab,
  Note,
  PomodoroState,
  QuickLink,
  Scope,
  Settings,
  SwitchOp,
  TodoList,
  Trash,
  WindowState,
  WorkspaceMeta,
  WorkspaceTabs,
} from "@/core/model/types";
import { DEFAULT_SETTINGS, KEY_PREFIX, Keys } from "@/core/model/types";
import { isBlankPageUrl } from "@/core/ops/url";
import { send } from "@/messaging/client";
import {
  type RecoveryHint,
  sanitizeClosed,
  sanitizeHint,
  sanitizeNote,
  sanitizePomodoro,
  sanitizeQuickLinks,
  sanitizeRecovery,
  sanitizeRev,
  sanitizeTodoList,
  sanitizeTrash,
} from "./sanitize";
import type { UiGroup, UiTab } from "./tabs";
import { duplicateExtras, duplicateGroups as groupDupes, mapGroup, mapTab } from "./tabs";
import { applyTheme } from "./theme";

export type { UiGroup, UiTab } from "./tabs";

/** Background-owned keys (src/background/keys.ts BgKeys; not imported: it pulls in valibot). */
export const RECOVERY_KEY = "recovery:pending";
export const IMPORT_FAILED_KEY = "import:failed";
export const RECOVERY_HINT_KEY = "recovery:hint";

/** Base URL of our placeholder page (unwraps suspended.html tabs). */
export const placeholderBase = (): string => chrome.runtime.getURL("/suspended.html");

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null;
const asMeta = (x: unknown) =>
  isObj(x) && typeof x.id === "string" && typeof x.name === "string" && Array.isArray(x.resources)
    ? (x as unknown as WorkspaceMeta)
    : null;
const asTabs = (x: unknown) =>
  isObj(x) && Array.isArray(x.tabs) ? (x as unknown as WorkspaceTabs) : null;
const asState = (x: unknown) =>
  isObj(x) && "activeWorkspaceId" in x ? (x as unknown as WindowState) : null;
const asOp = (x: unknown) =>
  isObj(x) && typeof x.to === "string" && Array.isArray(x.incoming)
    ? (x as unknown as SwitchOp)
    : null;
const asIds = (x: unknown) => (Array.isArray(x) ? x.filter((i) => typeof i === "string") : []);

export const store = {
  windowId: signal<number | null>(null),
  index: signal<string[]>([]),
  metas: signal<Record<string, WorkspaceMeta>>({}),
  wsTabs: signal<Record<string, WorkspaceTabs>>({}),
  windowStates: signal<Record<string, WindowState>>({}),
  liveWindowIds: signal<number[]>([]),
  liveTabs: signal<UiTab[]>([]),
  groups: signal<Record<number, UiGroup>>({}),
  opRecord: signal<SwitchOp | null>(null),
  opLive: signal<SwitchOp | null>(null),
  /** Set while a workspace.switch request from this page is in flight. */
  pendingSwitch: signal<{ to: string } | null>(null),
  recovery: signal<RecoveryPending | null>(null),
  importFailed: signal<Record<string, unknown> | null>(null),
  /** `recovery:hint`: a window of the last session was not restored. */
  hint: signal<RecoveryHint | null>(null),
  quicklinks: signal<QuickLink[]>([]),
  /** `quicklinks.rev` (expectedRev of quicklink.set). */
  quicklinksRev: signal(0),
  /**
   * Todo lists / notes by scope, loaded for "global" and the current window's active workspace
   * (on demand, `ensureScope`). A scope present here is loaded; a missing record is the empty
   * list / note at rev 0. Every later change arrives through onChanged.
   */
  todos: signal<Record<Scope, TodoList>>({}),
  notes: signal<Record<Scope, Note>>({}),
  /** `pomodoro`: null when no session runs. */
  pomodoro: signal<PomodoroState | null>(null),
  settings: signal<Settings>(DEFAULT_SETTINGS),
  recentlyClosed: signal<ClosedTab[]>([]),
  trash: signal<Trash>({ items: [] }),
  ready: signal(false),
};

export const activeWorkspaceId = computed(() => {
  const w = store.windowId.value;
  return w === null ? null : (store.windowStates.value[w]?.activeWorkspaceId ?? null);
});
export const activeMeta = computed(() => {
  const id = activeWorkspaceId.value;
  return id ? (store.metas.value[id] ?? null) : null;
});
/** Workspace id -> live window it is open in (stale window states are ignored). */
export const owners = computed(() => {
  const out: Record<string, number> = {};
  const live = new Set(store.liveWindowIds.value);
  for (const [w, st] of Object.entries(store.windowStates.value)) {
    if (st.activeWorkspaceId && live.has(Number(w))) out[st.activeWorkspaceId] = Number(w);
  }
  return out;
});
/** Ordered workspaces: the current window's active one first, then ws:index order. */
export const workspaces = computed(() => {
  const metas = store.metas.value;
  const list = store.index.value.map((id) => metas[id]).filter((m): m is WorkspaceMeta => !!m);
  const active = activeWorkspaceId.value;
  const i = list.findIndex((m) => m.id === active);
  if (i > 0) list.unshift(...list.splice(i, 1));
  return list;
});
export const op = computed(() => store.opLive.value ?? store.opRecord.value);
export const busy = computed(() => op.value !== null || store.pendingSwitch.value !== null);
/** Live tabs that belong to the workspace: not pinned, not a blank page. */
export const liveTabCount = computed(
  () => store.liveTabs.value.filter((x) => !x.pinned && !isBlankPageUrl(x.url)).length,
);
/** Duplicate groups of the current window (core findDuplicates); the kept tab first. */
export const duplicateGroups = computed(() => groupDupes(store.liveTabs.value, placeholderBase()));
/** Ids of the tabs "Close duplicates" would close (every group member but the kept one). */
export const duplicateIds = computed(
  () => new Set(duplicateExtras(duplicateGroups.value).map((x) => x.id)),
);
/** How many tabs "Close duplicates" would close in the current window. */
export const windowDuplicates = computed(() => duplicateIds.value.size);
export const recoveryAvailable = computed(() => {
  const w = store.windowId.value;
  return (
    (store.recovery.value?.entries.length ?? 0) > 0 ||
    store.importFailed.value !== null ||
    (w !== null && store.windowStates.value[w]?.provisional === true)
  );
});

const setKey = <T>(sig: Signal<Record<string, T>>, k: string, v: T | null) => {
  const next = { ...sig.peek() };
  if (v === null) delete next[k];
  else next[k] = v;
  sig.value = next;
};

function applyChange(key: string, raw: unknown): void {
  const s = store;
  if (key === Keys.wsIndex) {
    const ids = asIds(raw);
    s.index.value = ids;
    const missing = ids.filter((id) => !s.metas.peek()[id]);
    if (missing.length > 0) void loadWorkspaces(missing);
  } else if (key.startsWith(KEY_PREFIX.wsMeta)) setKey(s.metas, key.slice(8), asMeta(raw));
  else if (key.startsWith(KEY_PREFIX.wsTabs)) setKey(s.wsTabs, key.slice(8), asTabs(raw));
  else if (key.startsWith(KEY_PREFIX.window)) setKey(s.windowStates, key.slice(8), asState(raw));
  else if (key === Keys.opSwitch(s.windowId.peek() ?? -99)) s.opRecord.value = asOp(raw);
  else if (key === Keys.settings)
    s.settings.value = isObj(raw) ? (raw as unknown as Settings) : DEFAULT_SETTINGS;
  else if (key === Keys.recentlyClosed) s.recentlyClosed.value = sanitizeClosed(raw);
  else if (key === Keys.trash) s.trash.value = sanitizeTrash(raw);
  else if (key === RECOVERY_KEY) s.recovery.value = sanitizeRecovery(raw);
  else if (key === IMPORT_FAILED_KEY) s.importFailed.value = isObj(raw) ? raw : null;
  else if (key === RECOVERY_HINT_KEY) s.hint.value = sanitizeHint(raw);
  else if (key === Keys.quicklinks) {
    s.quicklinks.value = sanitizeQuickLinks(raw);
    s.quicklinksRev.value = sanitizeRev(raw);
  } else if (key.startsWith(KEY_PREFIX.todos))
    setKey(s.todos, key.slice(KEY_PREFIX.todos.length), sanitizeTodoList(raw));
  else if (key.startsWith(KEY_PREFIX.notes))
    setKey(s.notes, key.slice(KEY_PREFIX.notes.length), sanitizeNote(raw));
  else if (key === Keys.pomodoro) s.pomodoro.value = sanitizePomodoro(raw);
}

const scopeLoads = new Map<Scope, Promise<void>>();
/**
 * Loads `todos:<scope>` and `notes:<scope>` once (no-op when both are loaded). A record that an
 * onChanged event delivered while the read was in flight is newer and is kept.
 */
export function ensureScope(scope: Scope): Promise<void> {
  if (scope in store.todos.peek() && scope in store.notes.peek()) return Promise.resolve();
  const running = scopeLoads.get(scope);
  if (running) return running;
  const tk = Keys.todos(scope);
  const nk = Keys.notes(scope);
  const p = chrome.storage.local
    .get([tk, nk])
    .then((res) =>
      batch(() => {
        if (!(scope in store.todos.peek())) applyChange(tk, res[tk]);
        if (!(scope in store.notes.peek())) applyChange(nk, res[nk]);
      }),
    )
    .catch(() => undefined)
    .finally(() => scopeLoads.delete(scope));
  scopeLoads.set(scope, p);
  return p;
}

async function loadWorkspaces(ids: string[]): Promise<void> {
  const res = await chrome.storage.local.get(
    ids.flatMap((id) => [Keys.wsMeta(id), Keys.wsTabs(id)]),
  );
  batch(() => {
    for (const [k, v] of Object.entries(res)) applyChange(k, v);
  });
}

async function resolveWindowId(): Promise<number | null> {
  const fixed = Number(new URLSearchParams(location.search).get("window"));
  if (Number.isInteger(fixed) && fixed > 0) return fixed;
  const w = await chrome.windows.getCurrent().catch(() => null);
  return w?.id ?? null;
}

let tabTimer: ReturnType<typeof setTimeout> | undefined;
/** Incremented per refresh: a response is applied only if no newer refresh started since. */
let tabSeq = 0;
async function refreshTabs(): Promise<void> {
  const w = store.windowId.peek();
  if (w === null) return;
  const seq = ++tabSeq;
  const base = chrome.runtime.getURL("/suspended.html");
  const [tabs, groups] = await Promise.all([
    chrome.tabs.query({ windowId: w }).catch(() => []),
    chrome.tabGroups?.query({ windowId: w }).catch(() => []) ?? Promise.resolve([]),
  ]);
  if (seq !== tabSeq || store.windowId.peek() !== w) return;
  batch(() => {
    store.liveTabs.value = tabs.map((t) => mapTab(t, base)).sort((a, b) => a.index - b.index);
    store.groups.value = Object.fromEntries(groups.map((g) => [g.id, mapGroup(g)]));
  });
}
export function scheduleTabs(delay = 30): void {
  clearTimeout(tabTimer);
  tabTimer = setTimeout(() => void refreshTabs(), delay);
}

/** Loads window-scoped records for `w` and makes it the current window. */
async function selectWindow(w: number | null): Promise<void> {
  store.windowId.value = w;
  store.opLive.value = null;
  // An in-flight poll chain keeps going against the new window, with a fresh fast phase.
  pollStarted = Date.now();
  if (w === null) return;
  const res = await chrome.storage.local.get([Keys.window(w), Keys.opSwitch(w)]);
  batch(() => {
    setKey(store.windowStates, String(w), asState(res[Keys.window(w)]));
    store.opRecord.value = asOp(res[Keys.opSwitch(w)]);
  });
  await refreshTabs();
}

let polling = false;
let pollStarted = 0;
const POLL_FAST_MS = 100;
const POLL_FAST_WINDOW_MS = 5_000;
const POLL_SLOW_MS = 1_000;
/**
 * Polls op.status while an op exists or a switch was just requested: every 100 ms for the first
 * 5 s after the chain starts (or the window changes), then every second. One chain.
 */
function ensurePolling(): void {
  if (polling) return;
  polling = true;
  pollStarted = Date.now();
  void poll();
}
async function poll(): Promise<void> {
  const w = store.windowId.peek();
  if (w === null) {
    polling = false;
    return;
  }
  try {
    store.opLive.value = await send("op.status", { windowId: w });
  } catch {
    store.opLive.value = null;
  }
  const keep =
    store.opLive.peek() !== null ||
    store.opRecord.peek() !== null ||
    store.pendingSwitch.peek() !== null;
  if (keep) {
    const fast = Date.now() - pollStarted < POLL_FAST_WINDOW_MS;
    setTimeout(() => void poll(), fast ? POLL_FAST_MS : POLL_SLOW_MS);
  } else polling = false;
}

let started: Promise<void> | null = null;
export function initStore(): Promise<void> {
  started ??= start();
  return started;
}

async function start(): Promise<void> {
  // Tab events are followed from the start: one that fires while the initial tab query is in
  // flight schedules a newer refresh (events before the window id is known are not ours yet).
  subscribeTabs();
  // Listen before reading so no change is lost; changes that arrive during the initial reads
  // are applied after them (newer wins).
  let buffered: Array<[string, unknown]> | null = [];
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    const list = Object.entries(changes).map(([k, c]): [string, unknown] => [k, c.newValue]);
    if (buffered) buffered.push(...list);
    else
      batch(() => {
        for (const [k, v] of list) applyChange(k, v);
      });
  });
  const first = chrome.storage.local.get([
    Keys.wsIndex,
    Keys.settings,
    Keys.recentlyClosed,
    Keys.trash,
    RECOVERY_KEY,
    IMPORT_FAILED_KEY,
    RECOVERY_HINT_KEY,
    Keys.quicklinks,
    Keys.pomodoro,
    Keys.todos("global"),
    Keys.notes("global"),
  ]);
  const [w, wins, base] = await Promise.all([
    resolveWindowId(),
    chrome.windows.getAll({ windowTypes: ["normal"] }).catch(() => []),
    first,
  ]);
  const winIds = wins.map((x) => x.id).filter((x): x is number => typeof x === "number");
  const ids = asIds(base[Keys.wsIndex]);
  const keys = [
    ...ids.flatMap((id) => [Keys.wsMeta(id), Keys.wsTabs(id)]),
    ...winIds.map(Keys.window),
  ];
  const [rest] = await Promise.all([chrome.storage.local.get(keys), selectWindow(w)]);
  batch(() => {
    store.liveWindowIds.value = winIds;
    // Records before the index, so the index finds every workspace already loaded.
    for (const [k, v] of Object.entries(rest)) applyChange(k, v);
    for (const [k, v] of Object.entries(base)) applyChange(k, v);
    // The global todo list / note count as loaded even when they do not exist yet.
    for (const k of [Keys.todos("global"), Keys.notes("global")])
      if (!(k in base)) applyChange(k, undefined);
    for (const [k, v] of buffered ?? []) applyChange(k, v);
    buffered = null;
    store.ready.value = true;
  });
  subscribe();
}

/** tabs.onUpdated fields the UI shows (title, favicon, loading state, …); others are ignored. */
const TAB_FIELDS = [
  "title",
  "url",
  "favIconUrl",
  "status",
  "pinned",
  "audible",
  "mutedInfo",
  "discarded",
  "groupId",
] as const;
export const isRelevantTabChange = (c: chrome.tabs.OnUpdatedInfo): boolean =>
  TAB_FIELDS.some((f) => f in c);

function subscribeTabs(): void {
  const mine = (wid: number | undefined) => wid !== undefined && wid === store.windowId.peek();
  const any = () => scheduleTabs();
  chrome.tabs.onCreated.addListener((t) => mine(t.windowId) && any());
  chrome.tabs.onUpdated.addListener(
    (_id, c, t) => mine(t.windowId) && isRelevantTabChange(c) && any(),
  );
  chrome.tabs.onRemoved.addListener((_id, info) => mine(info.windowId) && any());
  chrome.tabs.onMoved.addListener((_id, info) => mine(info.windowId) && any());
  chrome.tabs.onActivated.addListener((info) => mine(info.windowId) && any());
  chrome.tabs.onAttached.addListener((_id, info) => mine(info.newWindowId) && any());
  chrome.tabs.onDetached.addListener((_id, info) => mine(info.oldWindowId) && any());
  chrome.tabs.onReplaced.addListener(any);
  if (chrome.tabGroups) {
    chrome.tabGroups.onCreated.addListener(any);
    chrome.tabGroups.onUpdated.addListener(any);
    chrome.tabGroups.onRemoved.addListener(any);
  }
}

function subscribe(): void {
  const fixed = new URLSearchParams(location.search).has("window");
  chrome.windows.onFocusChanged.addListener(() => {
    if (fixed) return;
    void resolveWindowId().then((w) => {
      if (w !== store.windowId.peek()) void selectWindow(w);
    });
  });
  chrome.windows.onCreated.addListener((win) => {
    if (win.id === undefined) return;
    store.liveWindowIds.value = [...store.liveWindowIds.peek(), win.id];
  });
  chrome.windows.onRemoved.addListener((id) => {
    store.liveWindowIds.value = store.liveWindowIds.peek().filter((x) => x !== id);
  });
  effect(() => applyTheme(store.settings.value.theme));
  // The active workspace's todo list and note (the dashboard / side panel scope switch).
  effect(() => {
    const id = activeWorkspaceId.value;
    if (id) void ensureScope(id);
  });
  effect(() => {
    const need = store.opRecord.value !== null || store.pendingSwitch.value !== null;
    if (need) ensurePolling();
  });
}

/** Sets up the read model once per page; components then read the signals directly. */
export function useStore(): typeof store {
  useEffect(() => {
    void initStore();
  }, []);
  return store;
}
