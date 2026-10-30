import { beforeEach, describe, expect, it, vi } from "vitest";
import { LIMITS } from "@/core/model/types";
import { parsePlaceholderUrl } from "@/core/ops/url";
import type { UiTab } from "./tabs";

const BASE = "chrome-extension://ext/suspended.html";

const live = (id: number, url: string, over: Partial<UiTab> = {}): UiTab => ({
  id,
  windowId: 1,
  index: id,
  url,
  rawUrl: url,
  title: `T${id}`,
  pinned: false,
  active: false,
  audible: false,
  discarded: false,
  groupId: -1,
  placeholder: false,
  ...over,
});

interface Toast {
  message: string;
  action?: { label: string; run: () => void };
}

let toasts: Toast[];
let rpc: Array<{ type: string; payload: unknown }>;
let reply: unknown;
let remaining: number[];
let created: Array<{ windowId?: number; url?: string; active?: boolean }>;

async function load() {
  vi.resetModules();
  vi.doMock("./components/Toast", () => ({
    showToast: (t: Toast) => toasts.push(t),
    dismissToast: () => {},
  }));
  const client = await import("@/messaging/client");
  client.setTransport(async (msg) => {
    rpc.push({ type: msg.type, payload: msg.payload });
    return { ok: true, value: reply };
  });
  const { store } = await import("./store");
  const actions = await import("./tabActions");
  return { store, ...actions };
}

beforeEach(() => {
  toasts = [];
  rpc = [];
  reply = null;
  remaining = [];
  created = [];
  vi.stubGlobal("chrome", {
    runtime: { getURL: (p: string) => `chrome-extension://ext${p}` },
    tabs: {
      remove: vi.fn(async () => {}),
      query: vi.fn(async () => remaining.map((id) => ({ id, windowId: 1 }))),
      create: vi.fn(async (o: { windowId?: number; url?: string }) => {
        created.push(o);
        return { id: 99, ...o };
      }),
    },
  });
});

describe("toggleWhitelist", () => {
  it("adds a normalized, deduped host", async () => {
    const { toggleWhitelist } = await load();
    expect(toggleWhitelist(["Example.org", "example.org", ""], "news.site.example")).toEqual({
      whitelist: ["example.org", "news.site.example"],
      added: true,
      removed: [],
    });
  });

  it("removes every entry that covers the host (itself or a parent domain)", async () => {
    const { toggleWhitelist } = await load();
    expect(toggleWhitelist(["*.site.example", "other.example"], "news.site.example")).toEqual({
      whitelist: ["other.example"],
      added: false,
      removed: ["*.site.example"],
    });
  });
});

describe("reopenTargets", () => {
  it("hints each tab with its own window's active workspace, none when unknown", async () => {
    const { reopenTargets } = await load();
    const tabs = [
      live(1, "https://a.example/", { windowId: 1 }),
      live(2, "https://b.example/", { windowId: 2 }),
      live(3, "https://c.example/", { windowId: 3 }),
      live(4, "chrome://settings/", { windowId: 1 }),
      live(5, "edge://weird/", { windowId: 1 }),
    ];
    const out = reopenTargets(
      tabs,
      { "1": { activeWorkspaceId: "wsA" }, "2": { activeWorkspaceId: null } },
      BASE,
    );
    expect(out.map((x) => x.windowId)).toEqual([1, 2, 3, 1]);
    const ph = out.map((x) => parsePlaceholderUrl(x.url, BASE));
    expect(ph.map((x) => x?.w ?? null)).toEqual(["wsA", "", "", null]);
    expect(ph[0]?.u).toBe("https://a.example/");
    expect(out[3]?.url).toBe("chrome://settings/");
  });
});

describe("tab actions with undo", () => {
  it("closing a tab offers Undo that reopens it as a placeholder in its window", async () => {
    const { store, closeTab } = await load();
    store.windowId.value = 1;
    await closeTab(live(5, "https://a.example/x", { windowId: 7, title: "A page" }));
    expect(chrome.tabs.remove).toHaveBeenCalledWith(5);
    expect(toasts[0]?.message).toBe("Closed “A page”");
    toasts[0]?.action?.run();
    await vi.waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]?.windowId).toBe(7);
    expect(created[0]?.active).toBe(false);
    expect(parsePlaceholderUrl(created[0]?.url ?? "", BASE)?.u).toBe("https://a.example/x");
  });

  it("Close N dupes: Undo recreates exactly the tabs that were closed", async () => {
    const { store, closeDuplicates } = await load();
    store.windowId.value = 1;
    store.liveTabs.value = [
      live(1, "https://dup.example/", { active: true }),
      live(2, "https://dup.example/"),
      live(3, "https://dup.example/"),
      live(4, "https://solo.example/"),
    ];
    reply = 2;
    remaining = [1, 3, 4]; // tab 3 survived (e.g. closed elsewhere first / locked)
    await closeDuplicates();
    expect(rpc).toEqual([{ type: "tabs.closeDuplicates", payload: { windowId: 1 } }]);
    expect(toasts[0]?.message).toBe("Closed 2 duplicate tabs");
    toasts[0]?.action?.run();
    await vi.waitFor(() => expect(created).toHaveLength(1));
    expect(parsePlaceholderUrl(created[0]?.url ?? "", BASE)?.t).toBe("T2");
  });

  it("Suspend others mentions that auto-suspend is off, with a Turn on action", async () => {
    const { store, suspendOthers } = await load();
    store.windowId.value = 1;
    reply = 3;
    await suspendOthers();
    expect(toasts[0]?.message).toBe("Suspended 3 tabs · Auto-suspend is off");
    expect(toasts[0]?.action?.label).toBe("Turn on");
    store.settings.value = {
      ...store.settings.value,
      suspend: { ...store.settings.value.suspend, enabled: true },
    };
    await suspendOthers();
    expect(toasts[1]).toEqual({ message: "Suspended 3 tabs" });
  });

  it("Undo uses the source window's workspace; a closed window reopens here without a hint", async () => {
    const { store, closeTab } = await load();
    store.windowId.value = 1;
    store.windowStates.value = {
      "7": { activeWorkspaceId: "wsB", sessionEpoch: "e" },
    } as typeof store.windowStates.value;
    await closeTab(live(5, "https://a.example/x", { windowId: 7 }));
    await closeTab(live(6, "https://b.example/y", { windowId: 8 }));
    vi.mocked(chrome.tabs.create).mockImplementation(async (o) => {
      if (o.windowId === 8) throw new Error("No window with id: 8.");
      created.push(o);
      return { id: 99 } as chrome.tabs.Tab;
    });
    toasts[0]?.action?.run();
    await vi.waitFor(() => expect(created).toHaveLength(1));
    expect(parsePlaceholderUrl(created[0]?.url ?? "", BASE)?.w).toBe("wsB");
    toasts[1]?.action?.run();
    await vi.waitFor(() => expect(created).toHaveLength(2));
    expect(created[1]?.windowId).toBeUndefined();
    expect(parsePlaceholderUrl(created[1]?.url ?? "", BASE)?.w).toBe("");
    await vi.waitFor(() => expect(toasts.at(-1)?.message).toBe("Window was closed; reopened here"));
  });

  it("the whitelist toggle refuses to add past the limit", async () => {
    const { store, toggleSiteWhitelist } = await load();
    const full = Array.from({ length: LIMITS.whitelistHosts }, (_, i) => `h${i}.example`);
    store.settings.value = {
      ...store.settings.value,
      suspend: { ...store.settings.value.suspend, whitelist: full },
    };
    await toggleSiteWhitelist("new.example");
    expect(rpc).toEqual([]);
    expect(toasts[0]?.message).toBe(
      `The never-suspend list is full (${LIMITS.whitelistHosts} sites). Remove some in Settings.`,
    );
  });

  it("allowing a site names the whitelist entry removed", async () => {
    const { store, toggleSiteWhitelist } = await load();
    store.settings.value = {
      ...store.settings.value,
      suspend: { ...store.settings.value.suspend, whitelist: ["example.com"] },
    };
    reply = store.settings.value;
    await toggleSiteWhitelist("docs.example.com");
    expect(toasts[0]?.message).toBe("Removed example.com from the never-suspend list");
  });

  it("parking a tab that is already a saved link only says so", async () => {
    const { store, parkTab } = await load();
    store.liveTabs.value = [live(3, "https://saved.example/page")];
    store.metas.value = {
      ws1: { resources: [{ url: "https://saved.example/page#x" }] },
    } as unknown as typeof store.metas.value;
    await parkTab(3, "ws1");
    expect(rpc).toEqual([]);
    expect(toasts[0]?.message).toBe("Already saved");
  });

  it("the whitelist toggle sends settings.update with the current rev", async () => {
    const { store, toggleSiteWhitelist } = await load();
    store.settings.value = { ...store.settings.value, rev: 4 };
    reply = store.settings.value;
    await toggleSiteWhitelist("a.example");
    expect(rpc[0]?.type).toBe("settings.update");
    expect(rpc[0]?.payload).toMatchObject({
      expectedRev: 4,
      patch: { suspend: { whitelist: ["a.example"] } },
    });
  });
});
