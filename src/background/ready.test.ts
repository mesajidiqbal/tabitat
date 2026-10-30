import { describe, expect, it } from "vitest";
import type {
  Meta,
  SessionGeneration,
  SwitchOp,
  WindowState,
  WorkspacePrev,
  WorkspaceTabs,
} from "../core/model/types";
import { Keys, PROVISIONAL_MS, SCHEMA_VERSION } from "../core/model/types";
import { BgKeys, type RecoveryPending } from "./keys";
import { ReadyBarrier } from "./ready";
import { seedWorkspace, settle, setup, stored } from "./testing/harness";

describe("init", () => {
  it("fresh install: epoch, migration, alarms, generation", async () => {
    const h = await setup({ windows: [["https://a.example/"]] });
    const r = h.svc.initReport;
    expect(r?.contextReset).toBe(true);
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
    expect(h.svc.initReport?.contextReset).toBe(false);
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
      reason: "session changed",
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

  it("data from a newer schema: init fails, degraded read-only mode, mutating -> internal", async () => {
    const h = await setup({
      skipInit: true,
      windows: [["https://a.example/"]],
      before: (fake) =>
        fake.local.set(Keys.meta, {
          schemaVersion: SCHEMA_VERSION + 1,
          installedAt: 1,
          flavor: "default",
        }),
    });
    await expect(h.svc.init()).rejects.toThrow(/newer/);
    expect(await h.svc.ready()).toMatchObject({ degraded: true });
    expect(await h.rpc("system.ping", {})).toMatchObject({
      ok: true,
      value: { ready: true, degraded: true },
    });
    expect((await h.rpc("op.status", { windowId: 1 })).ok).toBe(true);
    expect((await h.rpc("backup.export", {})).ok).toBe(true);
    expect(await h.rpc("note.set", { scope: "global", content: "x" })).toMatchObject({
      ok: false,
      code: "internal",
      retryable: true,
    });
    // the tracker does not write while degraded
    const w = h.fake.windowIds()[0] as number;
    h.fake.openTab(w, "https://b.example/");
    await settle();
    expect(stored(h.fake, Keys.dirty(w))).toBeUndefined();
    expect(stored<Meta>(h.fake, Keys.meta)?.schemaVersion).toBe(SCHEMA_VERSION + 1);
  });

  it("a failed init is retried by the next message / alarm and then works (H)", async () => {
    const h = await setup({ skipInit: true, windows: [["https://a.example/"]] });
    h.fake.failNext("session.get"); // epoch read fails: init fails
    await expect(h.svc.init()).rejects.toThrow(/injected/);
    expect(h.svc.barrier.isDegraded).toBe(true);
    // the next mutating message re-attempts init first, then runs
    expect((await h.rpc("note.set", { scope: "global", content: "x" })).ok).toBe(true);
    expect(h.svc.barrier.isDegraded).toBe(false);
    expect(h.svc.initReport?.epoch).not.toBe("");
    // an alarm in a degraded worker also retries
    const h2 = await setup({ skipInit: true });
    h2.fake.failNext("session.get");
    await expect(h2.svc.init()).rejects.toThrow();
    await h2.svc.onAlarm("flush-dirty");
    await settle();
    expect(h2.svc.barrier.isDegraded).toBe(false);
  });

  it("a missing epoch means 'worker context reset': ids are verified by content (H)", async () => {
    const h = await setup({
      windows: [["https://a.example/1", "https://a.example/2"], ["https://other.example/"]],
      before: (fake) => seedWorkspace(fake, "A", ["https://a.example/1", "https://a.example/2"]),
    });
    const [w1, w2] = h.fake.windowIds() as [number, number];
    expect(stored<WindowState>(h.fake, Keys.window(w1))?.activeWorkspaceId).toBe("A");
    // extension reload: storage.session cleared, same windows and ids
    h.fake.session.clear();
    // and a stale record from another session naming a reused id with different content
    h.fake.local.set(Keys.window(w2), { activeWorkspaceId: "A", sessionEpoch: "ancient" });
    await h.restart();
    expect(h.svc.initReport?.contextReset).toBe(true);
    const st1 = stored<WindowState>(h.fake, Keys.window(w1));
    expect(st1).toMatchObject({ activeWorkspaceId: "A", sessionEpoch: h.svc.ctx.epoch });
    expect(stored<WindowState>(h.fake, Keys.window(w2))?.activeWorkspaceId).not.toBe("A");
  });

  it("prunes windows:* records whose window id is not live (M)", async () => {
    const h = await setup({ windows: [["https://a.example/"]] });
    h.fake.local.set(Keys.window(999), { activeWorkspaceId: null, sessionEpoch: h.svc.ctx.epoch });
    await h.restart();
    expect(stored(h.fake, Keys.window(999))).toBeUndefined();
  });

  it("ReadyBarrier: a failed attempt is retried by the next run; success is cached", async () => {
    const b = new ReadyBarrier();
    let n = 0;
    await expect(
      b.run(async () => {
        n++;
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await b.ready()).toMatchObject({ degraded: true, error: "boom" });
    await b.run(async () => {
      n++;
    });
    await b.run(async () => {
      n++;
    });
    expect(n).toBe(2);
    expect(await b.ready()).toEqual({ degraded: false });
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

  it("heuristic reconciliation is provisional: storage generation first, ws:prev kept (F)", async () => {
    const saved = Array.from({ length: 10 }, (_, i) => `https://a.example/${i}`);
    const h = await setup({
      // a partial restore: only 6 of A's 10 tabs came back (Jaccard 0.6)
      windows: [saved.slice(0, 6)],
      before: (fake) => seedWorkspace(fake, "A", saved),
    });
    const w = h.fake.windowIds()[0] as number;
    const st = stored<WindowState>(h.fake, Keys.window(w));
    expect(st).toMatchObject({ activeWorkspaceId: "A", provisional: true });
    expect(h.svc.initReport?.matches).toContainEqual({
      windowId: w,
      workspaceId: "A",
      reason: "similarity",
    });
    // a generation built purely from storage, written before the assignment
    const index = stored<number[]>(h.fake, Keys.sessionsIndex) ?? [];
    const first = stored<SessionGeneration>(h.fake, Keys.sessionGen(index[0] as number));
    expect(first?.windows).toEqual([
      expect.objectContaining({ windowId: 0, workspaceId: "A", tabs: expect.any(Array) }),
    ]);
    expect(first?.windows[0]?.tabs).toHaveLength(10);
    // the tracker shrinks A to the 6 live tabs, but the 10 saved ones survive in ws:prev:A
    await h.svc.tracker.flush(w);
    expect(stored<WorkspaceTabs>(h.fake, Keys.wsTabs("A"))?.tabs).toHaveLength(6);
    expect(stored<WorkspacePrev>(h.fake, Keys.wsPrev("A"))?.tabs.tabs).toHaveLength(10);
    // 10 minutes of tracking end the provisional period
    h.fake.advance(PROVISIONAL_MS);
    await h.svc.tracker.flush(w);
    expect(stored<WindowState>(h.fake, Keys.window(w))?.provisional).toBeUndefined();
  });

  it("a user-initiated switch ends the provisional period (F)", async () => {
    const h = await setup({
      windows: [["https://a.example/1", "https://a.example/2"]],
      before: (fake) => {
        seedWorkspace(fake, "A", ["https://a.example/1", "https://a.example/2"]);
        seedWorkspace(fake, "B", ["https://b.example/"]);
      },
    });
    const w = h.fake.windowIds()[0] as number;
    expect(stored<WindowState>(h.fake, Keys.window(w))?.provisional).toBe(true);
    await h.ok("workspace.switch", { windowId: w, workspaceId: "B" });
    expect(stored<WindowState>(h.fake, Keys.window(w))).toEqual({
      activeWorkspaceId: "B",
      sessionEpoch: h.svc.ctx.epoch,
    });
  });

  it("if the storage generation cannot be written, similarity is not applied (F)", async () => {
    const h = await setup({
      skipInit: true,
      windows: [["https://a.example/1", "https://a.example/2"]],
      before: (fake) => seedWorkspace(fake, "A", ["https://a.example/1", "https://a.example/2"]),
    });
    h.fake.failNext("storage.set", {
      when: (items) => Object.keys(items as object).some((k) => k.startsWith("sessions:gen:")),
    });
    await h.svc.init();
    const w = h.fake.windowIds()[0] as number;
    expect(stored<WindowState>(h.fake, Keys.window(w))?.activeWorkspaceId).toBeNull();
  });
});
