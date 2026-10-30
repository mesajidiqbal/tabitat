import { describe, expect, it } from "vitest";
import type { SessionGeneration } from "../core/model/types";
import { Keys, LIMITS } from "../core/model/types";
import { setup, stored, unwrappedUrls } from "./testing/harness";

describe("SessionGuard", () => {
  it("keeps a ring of 10 generations", async () => {
    const h = await setup({ windows: [["https://a.example/"]] });
    const w = h.fake.windowIds()[0] as number;
    for (let i = 0; i < 14; i++) {
      h.fake.openTab(w, `https://n.example/${i}`);
      await h.svc.sessionGuard.take();
    }
    const index = stored<number[]>(h.fake, Keys.sessionsIndex) ?? [];
    expect(index).toHaveLength(LIMITS.sessionGenerations);
    expect(index).toEqual(Array.from({ length: 10 }, (_, i) => i + 6));
    expect(stored(h.fake, Keys.sessionGen(5))).toBeUndefined();
    expect(stored<SessionGeneration>(h.fake, Keys.sessionGen(15))?.windows[0]?.tabs).toHaveLength(
      15,
    );
    const list = await h.svc.sessionGuard.list();
    expect(list[0]).toMatchObject({ id: 15, windows: 1, tabs: 15 });
  });

  it("skips unchanged and all-empty states (unless forced)", async () => {
    const h = await setup({ windows: [["https://a.example/"]] });
    const first = stored<number[]>(h.fake, Keys.sessionsIndex);
    expect(first).toEqual([1]); // init took one
    expect(await h.svc.sessionGuard.take()).toBeNull();
    expect(await h.svc.sessionGuard.take({ force: true })).toBe(2);
    const empty = await setup({ windows: [[{ url: "https://p.example/", pinned: true }]] });
    expect(await empty.svc.sessionGuard.take({ force: true })).toBeNull();
    expect(await empty.rpc("session.snapshotNow", {})).toMatchObject({ code: "invalid" });
  });

  it("stores placeholders unwrapped and restores a generation into a new window", async () => {
    const base = "chrome-extension://fakeextensionid/suspended.html";
    const ph = `${base}#u=${encodeURIComponent("https://p.example/x")}&t=P&w=ws&s=s1`;
    const h = await setup({ windows: [["https://a.example/", ph], ["https://c.example/"]] });
    const gen = stored<SessionGeneration>(h.fake, Keys.sessionGen(1));
    expect(gen?.windows.map((w) => w.tabs.map((t) => t.url))).toEqual([
      ["https://a.example/", "https://p.example/x"],
      ["https://c.example/"],
    ]);
    const { windowId } = await h.ok("session.restore", { generation: 1 });
    expect(unwrappedUrls(h.fake, windowId, h.placeholderBase)).toEqual([
      "https://a.example/",
      "https://p.example/x",
      "https://c.example/",
    ]);
    expect(h.fake.urlsOf(windowId)).not.toContain("about:blank");
    expect(await h.rpc("session.restore", { generation: 99 })).toMatchObject({ code: "not_found" });
  });

  it("windows.onRemoved and the session-gen alarm take generations", async () => {
    const h = await setup({ windows: [["https://a.example/"], ["https://b.example/"]] });
    const [w1] = h.fake.windowIds() as [number];
    h.fake.closeWindow(w1);
    await new Promise((r) => setTimeout(r, 0));
    await h.svc.ready();
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
    expect(stored<number[]>(h.fake, Keys.sessionsIndex)).toEqual([1, 2]);
    h.fake.openTab(h.fake.windowIds()[0] as number, "https://z.example/");
    await h.svc.onAlarm("session-gen");
    expect(stored<number[]>(h.fake, Keys.sessionsIndex)).toEqual([1, 2, 3]);
  });
});
