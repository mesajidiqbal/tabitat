import { beforeEach, describe, expect, it, vi } from "vitest";
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
    });
  });

  it("removes every entry that covers the host (itself or a parent domain)", async () => {
    const { toggleWhitelist } = await load();
    expect(toggleWhitelist(["*.site.example", "other.example"], "news.site.example")).toEqual({
      whitelist: ["other.example"],
      added: false,
    });
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
