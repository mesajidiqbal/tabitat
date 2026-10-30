import { describe, expect, it } from "vitest";
import type { Meta, SwitchOp, WindowState } from "../core/model/types";
import { Keys, SCHEMA_VERSION } from "../core/model/types";
import { BgKeys, type RecoveryPending } from "./keys";
import { ReadyBarrier } from "./ready";
import { seedWorkspace, setup, stored } from "./testing/harness";

describe("init", () => {
  it("fresh install: epoch, migration, alarms, generation", async () => {
    const h = await setup({ windows: [["https://a.example/"]] });
    const r = h.svc.initReport;
    expect(r?.browserStarted).toBe(true);
    expect(r?.migrated).toEqual([1]);
    expect(stored<Meta>(h.fake, Keys.meta)?.schemaVersion).toBe(SCHEMA_VERSION);
    expect(stored(h.fake, Keys.settings)).toBeDefined();
    expect(stored(h.fake, Keys.migration(1))).toBeUndefined();
    expect([...h.fake.alarms.keys()].sort()).toEqual(["flush-dirty", "session-gen", "trash-purge"]);
    expect(h.fake.alarms.get("session-gen")?.periodInMinutes).toBe(5);
    expect(r?.generation).toBe(1);
    expect(h.fake.session.get(Keys.epoch)).toBe(r?.epoch);
    expect(await h.ok("system.ping", {})).toEqual({ epoch: r?.epoch, ready: true });
  });

  it("worker restart keeps the epoch and does not re-migrate; alarm repair recreates missing", async () => {
    const h = await setup({ windows: [["https://a.example/"]] });
    const epoch = h.svc.initReport?.epoch;
    h.fake.alarms.delete("flush-dirty");
    await h.restart();
    expect(h.svc.initReport?.epoch).toBe(epoch);
    expect(h.svc.initReport?.browserStarted).toBe(false);
    expect(h.svc.initReport?.migrated).toEqual([]);
    expect(h.svc.initReport?.alarmsCreated).toEqual(["flush-dirty"]);
  });

  it("suspend-scan alarm follows the setting", async () => {
    const h = await setup({ windows: [["https://a.example/"]] });
    await h.ok("settings.update", { patch: { suspend: { enabled: true } as never } });
    expect(h.fake.alarms.has("suspend-scan")).toBe(true);
    await h.ok("settings.update", {
      patch: { suspend: { enabled: false } as never, sessions: { everyMinutes: 7, keep: 10 } },
    });
    expect(h.fake.alarms.has("suspend-scan")).toBe(false);
    expect(h.fake.alarms.get("session-gen")?.periodInMinutes).toBe(7);
  });

  it("abandons an op from another browser session: recovery:pending set, nothing deleted", async () => {
    const h = await setup({
      windows: [["https://a.example/"]],
      before: (fake) => {
        seedWorkspace(fake, "A", ["https://a.example/"]);
        seedWorkspace(fake, "B", ["https://b.example/"]);
        const op: SwitchOp = {
          id: "op",
          windowId: 77,
          from: "A",
          to: "B",
          stage: "closing",
          sessionEpoch: "old-epoch",
          outgoingTabIds: [1, 2],
          createdTabIds: { "B-t0": 3 },
          incoming: [{ id: "B-t0", url: "https://b.example/", title: "B", index: 0 }],
          skipped: [],
          startedAt: 1,
          attempts: 0,
        };
        fake.local.set(Keys.opSwitch(77), op);
        fake.local.set(Keys.window(77), { activeWorkspaceId: "A", sessionEpoch: "old-epoch" });
      },
    });
    expect(stored(h.fake, Keys.opSwitch(77))).toBeUndefined();
    const rec = stored<RecoveryPending>(h.fake, BgKeys.recoveryPending);
    expect(rec?.entries[0]).toMatchObject({
      opId: "op",
      from: "A",
      to: "B",
      reason: "browser restarted",
    });
    expect(rec?.entries[0]?.fromSnapshot?.tabs[0]?.url).toBe("https://a.example/");
    expect(stored(h.fake, Keys.wsMeta("A"))).toBeDefined();
    expect(stored(h.fake, Keys.wsTabs("B"))).toBeDefined();
    expect(stored(h.fake, Keys.window(77))).toBeUndefined(); // stale window record dropped
  });

  it("reconcile assigns windows by placeholder hint after a browser restart", async () => {
    const base = "chrome-extension://fakeextensionid/suspended.html";
    const ph = (u: string, w: string, s: string) =>
      `${base}#u=${encodeURIComponent(u)}&t=x&w=${w}&s=${s}`;
    const h = await setup({
      windows: [
        [
          ph("https://b.example/1", "B", "b1"),
          ph("https://b.example/2", "B", "b2"),
          "https://other.example/",
        ],
        ["https://a.example/1", "https://a.example/2", "https://a.example/3"],
        ["https://unrelated.example/"],
      ],
      before: (fake) => {
        seedWorkspace(fake, "A", [
          "https://a.example/1",
          "https://a.example/2",
          "https://a.example/3",
          "https://a.example/4",
        ]);
        seedWorkspace(fake, "B", ["https://zzz.example/"]);
      },
    });
    const [w1, w2, w3] = h.fake.windowIds() as [number, number, number];
    expect(stored<WindowState>(h.fake, Keys.window(w1))?.activeWorkspaceId).toBe("B");
    expect(stored<WindowState>(h.fake, Keys.window(w2))?.activeWorkspaceId).toBe("A");
    expect(stored<WindowState>(h.fake, Keys.window(w3))?.activeWorkspaceId).toBeNull();
    const epoch = h.svc.ctx.epoch;
    expect(stored<WindowState>(h.fake, Keys.window(w1))?.sessionEpoch).toBe(epoch);

    // browser restart: new window ids, records re-matched, stale ones removed
    await h.restart({ browser: true });
    const [n1, n2] = h.fake.windowIds() as [number, number];
    expect(h.svc.ctx.epoch).not.toBe(epoch);
    expect(stored<WindowState>(h.fake, Keys.window(n1))?.activeWorkspaceId).toBe("B");
    expect(stored<WindowState>(h.fake, Keys.window(n2))?.activeWorkspaceId).toBe("A");
    expect(stored(h.fake, Keys.window(w1))).toBeUndefined();
  });

  it("a workspace owned by two valid windows: the second becomes Unsorted", async () => {
    const h = await setup({
      windows: [["https://a.example/"], ["https://b.example/"]],
      before: (fake) => seedWorkspace(fake, "A", ["https://q.example/"]),
    });
    const [w1, w2] = h.fake.windowIds() as [number, number];
    const epoch = h.svc.ctx.epoch;
    h.fake.local.set(Keys.window(w1), { activeWorkspaceId: "A", sessionEpoch: epoch });
    h.fake.local.set(Keys.window(w2), { activeWorkspaceId: "A", sessionEpoch: epoch });
    await h.restart();
    expect(stored<WindowState>(h.fake, Keys.window(w1))?.activeWorkspaceId).toBe("A");
    expect(stored<WindowState>(h.fake, Keys.window(w2))?.activeWorkspaceId).toBeNull();
  });

  it("refuses to run on data from a newer schema (ready rejects, commands answer internal)", async () => {
    const h = await setup({
      skipInit: true,
      before: (fake) =>
        fake.local.set(Keys.meta, {
          schemaVersion: SCHEMA_VERSION + 1,
          installedAt: 1,
          flavor: "default",
        }),
    });
    await expect(h.svc.init()).rejects.toThrow(/newer/);
    expect(await h.rpc("system.ping", {})).toMatchObject({ ok: false, code: "internal" });
    expect(stored<Meta>(h.fake, Keys.meta)?.schemaVersion).toBe(SCHEMA_VERSION + 1);
  });

  it("a failing non-fatal step is reported and init still completes", async () => {
    const h = await setup({ skipInit: true, windows: [["https://a.example/"]] });
    h.fake.failNext("windows.getAll");
    await h.svc.init();
    expect(h.svc.initReport?.errors.some((e) => e.startsWith("reconcile"))).toBe(true);
  });

  it("ReadyBarrier runs once", async () => {
    const b = new ReadyBarrier();
    let n = 0;
    await b.run(async () => {
      n++;
    });
    await b.run(async () => {
      n++;
    });
    expect(n).toBe(1);
    expect(b.isStarted).toBe(true);
  });
});
