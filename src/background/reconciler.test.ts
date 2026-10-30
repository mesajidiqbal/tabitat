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
    const h = await setup({ windows: [["https://a.example/"]] });
    const gen = latestGen(h);
    h.fake.local.set(BgKeys.recoveryHint, { generation: gen, unmatchedWindows: 1, at: 1 });
    for (let i = 0; i < 9; i++) await h.svc.sessionGuard.take({ force: true });
    expect(hint(h)).toBeDefined(); // still in the ring of 10
    await h.svc.sessionGuard.take({ force: true });
    expect(stored<number[]>(h.fake, Keys.sessionsIndex)).not.toContain(gen);
    expect(hint(h)).toBeUndefined();
  });
});
