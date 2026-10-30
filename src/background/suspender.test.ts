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
});
