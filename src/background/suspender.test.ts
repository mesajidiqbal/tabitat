import { describe, expect, it } from "vitest";
import type { TabInit } from "../platform/fake";
import { setup } from "./testing/harness";

const BASE = "chrome-extension://fakeextensionid/suspended.html";
const PH = `${BASE}#u=${encodeURIComponent("https://p.example/")}&t=P&w=ws&s=s1`;

describe("tabs.suspend", () => {
  it("discards an eligible tab, ignoring idle time, the whitelist and the enabled flag", async () => {
    const h = await setup({
      windows: [[{ url: "https://a.example/", active: true }, "https://b.example/"]],
    });
    await h.ok("settings.update", {
      patch: { suspend: { enabled: false, afterMinutes: 600, whitelist: ["b.example"] } },
    });
    const w = h.fake.windowIds()[0] as number;
    const b = h.fake.tabsOf(w)[1]?.id as number;
    expect(await h.ok("tabs.suspend", { tabId: b })).toBeNull();
    // tabs.discard replaces the id (spike S11)
    expect(h.fake.hasTab(b)).toBe(false);
    expect(h.fake.tabsOf(w).map((t) => [t.url, t.discarded])).toEqual([
      ["https://a.example/", false],
      ["https://b.example/", true],
    ]);
  });

  it.each<[string, TabInit]>([
    ["active", { url: "https://x.example/", active: true }],
    ["pinned", { url: "https://x.example/", pinned: true }],
    ["audible", { url: "https://x.example/", audible: true }],
    ["discarded", { url: "https://x.example/", discarded: true }],
    ["placeholder", { url: PH }],
    ["chrome:", { url: "chrome://settings/" }],
    ["file:", { url: "file:///tmp/x.html" }],
    ["ftp:", { url: "ftp://ftp.example/" }],
  ])("rejects a %s tab with invalid", async (_name, init) => {
    const h = await setup({
      windows: [[{ url: "https://keep.example/", active: !init.active }, init]],
    });
    const w = h.fake.windowIds()[0] as number;
    const tab = h.fake.tabsOf(w).find((t) => t.url === init.url)?.id as number;
    expect(await h.rpc("tabs.suspend", { tabId: tab })).toMatchObject({
      ok: false,
      code: "invalid",
    });
    expect(h.fake.hasTab(tab)).toBe(true);
    expect(h.fake.calls).not.toContain("tabs.discard");
  });

  it("not_found for an unknown tab; busy while the window has a switch", async () => {
    const h = await setup({
      windows: [[{ url: "https://a.example/", active: true }, "https://b.example/"]],
    });
    expect(await h.rpc("tabs.suspend", { tabId: 9999 })).toMatchObject({ code: "not_found" });
    const w = h.fake.windowIds()[0] as number;
    const b = h.fake.tabsOf(w)[1]?.id as number;
    h.svc.engine.lockWindow(w);
    expect(await h.rpc("tabs.suspend", { tabId: b })).toMatchObject({
      code: "busy",
      retryable: true,
    });
    h.svc.engine.unlockWindow(w);
    expect(await h.ok("tabs.suspend", { tabId: b })).toBeNull();
  });

  it("maps a tab that vanished during the discard to not_found", async () => {
    const h = await setup({
      windows: [[{ url: "https://a.example/", active: true }, "https://b.example/"]],
    });
    const w = h.fake.windowIds()[0] as number;
    const b = h.fake.tabsOf(w)[1]?.id as number;
    h.fake.failNext("tabs.discard", {
      error: new Error(`No tab with id: ${b}.`),
      when: () => {
        h.fake.closeTab(b);
        return true;
      },
    });
    expect(await h.rpc("tabs.suspend", { tabId: b })).toMatchObject({ code: "not_found" });
  });

  it("a tab moved between the lookups is discarded under the new window's lane (one retry)", async () => {
    const h = await setup({
      windows: [
        [{ url: "https://a.example/", active: true }, "https://b.example/"],
        [{ url: "https://c.example/", active: true }],
      ],
    });
    const [w1, w2] = h.fake.windowIds() as [number, number];
    const b = h.fake.tabsOf(w1)[1]?.id as number;
    const { ctx } = h.svc;
    // the tab moves right after the handler's first (lane-less) lookup
    const get = ctx.ports.tabs.get.bind(ctx.ports.tabs);
    let gets = 0;
    ctx.ports.tabs.get = async (id: number) => {
      const out = await get(id);
      if (id === b && ++gets === 1) h.fake.moveTab(b, w2);
      return out;
    };
    // record which window lanes each suspendOne ran under, and the lane held at the discard
    const run = ctx.lanes.run.bind(ctx.lanes);
    const suspendLanes: string[] = [];
    let held = "";
    const suspendOne = h.svc.suspender.suspendOne.bind(h.svc.suspender);
    ctx.lanes.run = <T>(l: readonly string[], fn: () => Promise<T>) =>
      run(l, async () => {
        const mine = l.filter((x) => x.startsWith("window:")).join();
        const prev = held;
        if (mine) held = mine;
        try {
          return await fn();
        } finally {
          held = prev;
        }
      });
    h.svc.suspender.suspendOne = (id: number, w: number) => {
      suspendLanes.push(held);
      return suspendOne(id, w);
    };
    const discards: string[] = [];
    const discard = ctx.ports.tabs.discard.bind(ctx.ports.tabs);
    ctx.ports.tabs.discard = (id: number) => {
      discards.push(held);
      return discard(id);
    };
    expect(await h.ok("tabs.suspend", { tabId: b })).toBeNull();
    expect(suspendLanes).toEqual([`window:${w1}`, `window:${w2}`]);
    expect(discards).toEqual([`window:${w2}`]);
    expect(h.fake.tabsOf(w2).find((t) => t.url === "https://b.example/")?.discarded).toBe(true);
  });

  it("a tab that keeps moving fails with busy after one retry", async () => {
    const h = await setup({
      windows: [
        [{ url: "https://a.example/", active: true }, "https://b.example/"],
        [{ url: "https://c.example/", active: true }],
      ],
    });
    const [w1, w2] = h.fake.windowIds() as [number, number];
    const b = h.fake.tabsOf(w1)[1]?.id as number;
    const { ctx } = h.svc;
    const get = ctx.ports.tabs.get.bind(ctx.ports.tabs);
    let gets = 0;
    ctx.ports.tabs.get = async (id: number) => {
      const out = await get(id);
      // after each lane-less lookup (calls 1 and 3), move it to the other window
      if (id === b && ++gets % 2 === 1) h.fake.moveTab(b, out?.windowId === w1 ? w2 : w1);
      return out;
    };
    expect(await h.rpc("tabs.suspend", { tabId: b })).toMatchObject({
      ok: false,
      code: "busy",
      retryable: true,
    });
    expect(h.fake.calls).not.toContain("tabs.discard");
  });
});
