import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { Keys } from "@/core/model/types";

/**
 * The store keeps module state (one init per page): every test loads fresh modules against the
 * WXT fake browser (storage, windows, runtime). The fake has no tabGroups and only some tabs
 * events, so `chrome.tabs` is a small controllable stand-in: `query` resolves immediately with
 * `tabs.now`, or (when `tabs.now` is null) waits until the test resolves it.
 */
const WIN = 1;

type Listener = (...args: unknown[]) => unknown;
const event = () => {
  const ls: Listener[] = [];
  return {
    addListener: (f: Listener) => void ls.push(f),
    removeListener: (f: Listener) => void ls.splice(ls.indexOf(f), 1),
    fire: (...args: unknown[]) => {
      for (const f of ls) f(...args);
    },
  };
};

const tab = (id: number, over: Partial<chrome.tabs.Tab> = {}): chrome.tabs.Tab =>
  ({
    id,
    windowId: WIN,
    index: id,
    url: `https://site.example/${id}`,
    title: `Tab ${id}`,
    pinned: false,
    active: false,
    groupId: -1,
    ...over,
  }) as chrome.tabs.Tab;

function fakeTabs() {
  const pending: Array<(tabs: chrome.tabs.Tab[]) => void> = [];
  const t = {
    now: [] as chrome.tabs.Tab[] | null,
    pending,
    query: vi.fn(
      (): Promise<chrome.tabs.Tab[]> =>
        t.now ? Promise.resolve(t.now) : new Promise((resolve) => pending.push(resolve)),
    ),
    onCreated: event(),
    onUpdated: event(),
    onRemoved: event(),
    onMoved: event(),
    onActivated: event(),
    onAttached: event(),
    onDetached: event(),
    onReplaced: event(),
  };
  return t;
}

let tabs: ReturnType<typeof fakeTabs>;
let rpcCalls: string[];

async function load() {
  vi.resetModules();
  const client = await import("@/messaging/client");
  client.setTransport(async (msg) => {
    rpcCalls.push(msg.type);
    return { ok: true, value: null };
  });
  return import("./store");
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  fakeBrowser.reset();
  tabs = fakeTabs();
  rpcCalls = [];
  vi.stubGlobal("chrome", { ...fakeBrowser, tabs, tabGroups: undefined });
  // A side panel / popup opened for a fixed window (?window=1); applyTheme needs a root.
  vi.stubGlobal("location", { search: `?window=${WIN}` });
  vi.stubGlobal("document", { documentElement: { dataset: {} } });
});

describe("store initialization", () => {
  it("(a) a storage change during the initial read wins over the initial snapshot", async () => {
    const old = { id: "c1", url: "https://old.example/", title: "Old", closedAt: 1 };
    const fresh = { id: "c2", url: "https://new.example/", title: "New", closedAt: 2 };
    await fakeBrowser.storage.local.set({ [Keys.recentlyClosed]: [old] });
    const { initStore, store } = await load();
    const ready = initStore(); // the initial read takes its snapshot now
    await fakeBrowser.storage.local.set({ [Keys.recentlyClosed]: [fresh] });
    await ready;
    expect(store.recentlyClosed.value).toEqual([fresh]);
    expect(store.ready.value).toBe(true);
  });

  it("(b) a tab event while the initial tab query is in flight is not lost", async () => {
    tabs.now = null;
    const { initStore, store } = await load();
    const ready = initStore();
    await vi.waitFor(() => expect(tabs.query).toHaveBeenCalledTimes(1));
    // A tab opens after the query was answered by the browser but before the UI got it.
    tabs.onCreated.fire(tab(2));
    tabs.now = [tab(1), tab(2)];
    tabs.pending.shift()?.([tab(1)]);
    await ready;
    await vi.waitFor(() => expect(store.liveTabs.value.map((x) => x.id)).toEqual([1, 2]));
  });

  it("(c) an older refreshTabs response does not overwrite a newer one", async () => {
    const { initStore, scheduleTabs, store } = await load();
    tabs.now = [tab(1)];
    await initStore();
    expect(store.liveTabs.value.map((x) => x.id)).toEqual([1]);

    tabs.now = null;
    scheduleTabs(0);
    await vi.waitFor(() => expect(tabs.pending).toHaveLength(1));
    scheduleTabs(0);
    await vi.waitFor(() => expect(tabs.pending).toHaveLength(2));
    const [older, newer] = tabs.pending;
    newer?.([tab(1), tab(3)]);
    await flush();
    older?.([tab(1), tab(2)]);
    await flush();
    expect(store.liveTabs.value.map((x) => x.id)).toEqual([1, 3]);
  });

  it("(d) malformed trash / recovery / recently-closed records are sanitized, not thrown on", async () => {
    const item = { id: "t1", kind: "link", deletedAt: 1, workspaceId: "A", link: {} };
    const closed = { id: "c", url: "https://a.example/", title: "A", closedAt: 1 };
    await fakeBrowser.storage.local.set({
      [Keys.trash]: { items: [null, item] },
      "recovery:pending": { entries: [null] },
      [Keys.recentlyClosed]: [null, closed, { title: "no url" }],
    });
    const { initStore, store, recoveryAvailable } = await load();
    await initStore();
    expect(store.trash.value.items).toEqual([item]);
    expect(store.recovery.value).toEqual({ entries: [] });
    expect(store.recentlyClosed.value).toEqual([closed]);
    expect(recoveryAvailable.value).toBe(false);

    // Later changes go through the same filters.
    await fakeBrowser.storage.local.set({ "recovery:pending": { entries: [null, { opId: "o" }] } });
    expect(store.recovery.value).toEqual({ entries: [{ opId: "o" }] });
    expect(recoveryAvailable.value).toBe(true);
  });

  it("(e) op.status polling starts when an op record appears and stops when it is gone", async () => {
    const { initStore, store } = await load();
    await initStore();
    await sleep(150);
    expect(rpcCalls).toEqual([]);

    await fakeBrowser.storage.local.set({ [Keys.opSwitch(WIN)]: { to: "B", incoming: [] } });
    expect(store.opRecord.value).not.toBeNull();
    await vi.waitFor(() => expect(rpcCalls.length).toBeGreaterThanOrEqual(2));
    expect(new Set(rpcCalls)).toEqual(new Set(["op.status"]));

    await fakeBrowser.storage.local.remove(Keys.opSwitch(WIN));
    expect(store.opRecord.value).toBeNull();
    await sleep(250); // the in-flight poll sees no op and ends the chain
    const stopped = rpcCalls.length;
    await sleep(300);
    expect(rpcCalls.length).toBe(stopped);
  });
});

describe("tab change filter", () => {
  it("only refreshes for fields the UI shows", async () => {
    const { isRelevantTabChange } = await load();
    expect(isRelevantTabChange({ title: "x" })).toBe(true);
    expect(isRelevantTabChange({ status: "loading" })).toBe(true);
    expect(isRelevantTabChange({ groupId: 3 })).toBe(true);
    expect(isRelevantTabChange({ autoDiscardable: false })).toBe(false);
    expect(isRelevantTabChange({})).toBe(false);
  });

  it("onUpdated with an irrelevant change does not query tabs", async () => {
    const { initStore } = await load();
    await initStore();
    const before = tabs.query.mock.calls.length;
    tabs.onUpdated.fire(1, { autoDiscardable: false }, tab(1));
    await sleep(60);
    expect(tabs.query.mock.calls.length).toBe(before);
    tabs.onUpdated.fire(1, { title: "New" }, tab(1));
    await vi.waitFor(() => expect(tabs.query.mock.calls.length).toBe(before + 1));
  });
});
