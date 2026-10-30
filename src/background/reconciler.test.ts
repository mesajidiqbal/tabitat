import { describe, expect, it } from "vitest";
import { Keys } from "../core/model/types";
import { BgKeys, type RecoveryHint } from "./keys";
import { type Harness, setup, stored } from "./testing/harness";

const hint = (h: Harness) => stored<RecoveryHint>(h.fake, BgKeys.recoveryHint);
const latestGen = (h: Harness) => stored<number[]>(h.fake, Keys.sessionsIndex)?.at(-1) as number;

/** Browser restart where only tabs passing `keep` come back (partial session restore). */
async function partialRestart(h: Harness, keep: (url: string) => boolean): Promise<void> {
  h.svc.stop();
  h.fake.restartBrowser({ keepTabs: (t) => keep(t.url) });
  await h.restart(); // fresh worker over the restarted browser (session already cleared)
}

const TWO_WINDOWS = [
  ["https://a.example/", "https://b.example/"],
  ["https://c.example/", "https://d.example/"],
];

describe("recovery:hint", () => {
  it("is written when a window of the latest generation did not come back", async () => {
    const h = await setup({ windows: TWO_WINDOWS });
    const gen = latestGen(h);
    await partialRestart(h, (u) => !/[cd]\.example/.test(u));
    expect(hint(h)).toEqual({ generation: gen, unmatchedWindows: 1, at: h.fake.clock });
  });

  it("is removed when every window matched after a restart", async () => {
    const h = await setup({ windows: TWO_WINDOWS });
    h.fake.local.set(BgKeys.recoveryHint, { generation: 1, unmatchedWindows: 1, at: 1 });
    await h.restart({ browser: true });
    expect(hint(h)).toBeUndefined();
  });

  it("ignores lost windows that only had blank tabs, and worker-only restarts", async () => {
    const h = await setup({ windows: [["https://a.example/"], ["chrome://newtab/"]] });
    await partialRestart(h, (u) => u !== "chrome://newtab/");
    expect(hint(h)).toBeUndefined();

    const h2 = await setup({ windows: TWO_WINDOWS });
    const stale = { generation: 1, unmatchedWindows: 2, at: 5 };
    h2.fake.local.set(BgKeys.recoveryHint, stale);
    await h2.restart(); // worker restart: epoch kept, nothing re-checked
    expect(hint(h2)).toEqual(stale);
  });

  it("recovery.dismissHint and session.restore remove it", async () => {
    const h = await setup({ windows: TWO_WINDOWS });
    const gen = latestGen(h);
    await partialRestart(h, (u) => !/[cd]\.example/.test(u));
    expect(hint(h)).toBeDefined();
    expect(await h.ok("recovery.dismissHint", {})).toBeNull();
    expect(hint(h)).toBeUndefined();
    expect(await h.ok("recovery.dismissHint", {})).toBeNull(); // idempotent

    h.fake.local.set(BgKeys.recoveryHint, { generation: gen, unmatchedWindows: 1, at: 1 });
    await h.ok("session.restore", { generation: gen });
    expect(hint(h)).toBeUndefined();
  });

  it("is removed when its generation leaves the ring", async () => {
    const h = await setup({ windows: TWO_WINDOWS });
    const gen = latestGen(h);
    await partialRestart(h, (u) => !/[cd]\.example/.test(u));
    expect(hint(h)?.generation).toBe(gen);
    const index = () => stored<number[]>(h.fake, Keys.sessionsIndex) ?? [];
    // c/d stay missing: later generations keep the hint until its generation is evicted
    while (index().length < 10) await h.svc.sessionGuard.take({ force: true }); // ring is full
    expect(index()[0]).toBe(gen);
    expect(hint(h)).toBeDefined();
    await h.svc.sessionGuard.take({ force: true });
    expect(index()).not.toContain(gen);
    expect(hint(h)).toBeUndefined();
  });

  it("a later generation clears it once its windows are back (delayed session restore)", async () => {
    const h = await setup({ windows: TWO_WINDOWS });
    await partialRestart(h, (u) => !/[cd]\.example/.test(u));
    expect(hint(h)).toBeDefined();
    await h.svc.sessionGuard.take({ force: true }); // still missing: kept
    expect(hint(h)).toBeDefined();
    h.fake.addWindow(["https://c.example/", "https://d.example/"], { emit: false });
    expect(await h.svc.sessionGuard.take()).not.toBeNull();
    expect(hint(h)).toBeUndefined();
  });

  it("one survivor does not satisfy two lost windows with the same URLs", async () => {
    const same = ["https://a.example/", "https://b.example/"];
    const h = await setup({ windows: [same, same, ["https://z.example/"]] });
    const gen = latestGen(h);
    const seen = new Set<string>();
    // z comes back, and a/b come back in one window only (each URL kept the first time)
    await partialRestart(h, (u) => {
      if (seen.has(u)) return false;
      seen.add(u);
      return true;
    });
    expect(hint(h)).toMatchObject({ generation: gen, unmatchedWindows: 1 });
  });

  it("the startup snapshot never clears it; the next one does", async () => {
    const h = await setup({ windows: TWO_WINDOWS });
    await partialRestart(h, (u) => !/[cd]\.example/.test(u));
    const before = latestGen(h);
    h.fake.addWindow(["https://c.example/", "https://d.example/"], { emit: false });
    await h.restart(); // worker restart: init's snapshot sees every window back
    expect(latestGen(h)).toBeGreaterThan(before); // a startup generation was written
    expect(hint(h)).toBeDefined();
    await h.svc.sessionGuard.take({ force: true });
    expect(hint(h)).toBeUndefined();
  });
});
