import { describe, expect, it } from "vitest";
import type {
  ClosedTab,
  SwitchOp,
  WindowState,
  WorkspaceMeta,
  WorkspaceTabs,
} from "../core/model/types";
import { Keys } from "../core/model/types";
import type { RecoveryPending } from "./keys";
import type { ServiceOptions } from "./services";
import {
  type Harness,
  placeholderIds,
  seedWorkspace,
  settle,
  setup,
  stored,
  unwrappedUrls,
} from "./testing/harness";

const PINNED = "https://pinned.example/";
const A_URLS = ["https://a.example/1", "https://a.example/2", "https://a.example/3"];
const bUrls = (n: number) => Array.from({ length: n }, (_, i) => `https://b.example/${i}`);

interface Ctx extends Harness {
  windowId: number;
  aId: string;
}

/** Window 1 = pinned + A's 3 tabs (A created from the window); B seeded with `bCount` tabs. */
async function world(bCount = 3, services: ServiceOptions = {}): Promise<Ctx> {
  const h = await setup({
    windows: [[{ url: PINNED, pinned: true }, ...A_URLS]],
    before: (fake) => {
      seedWorkspace(fake, "B", bUrls(bCount));
    },
    services: { debounceMs: 60_000, ...services },
  });
  const windowId = h.fake.windowIds()[0] as number;
  const a = await h.ok("workspace.create", { name: "A", color: "red", fromWindowId: windowId });
  return Object.assign(h, { windowId, aId: a.id });
}

function expectSwitched(h: Ctx, bCount: number) {
  const { fake, windowId } = h;
  const tabs = fake.tabsOf(windowId);
  expect(tabs[0]?.url).toBe(PINNED);
  expect(tabs[0]?.pinned).toBe(true);
  expect(unwrappedUrls(fake, windowId, h.placeholderBase)).toEqual(bUrls(bCount));
  const ids = placeholderIds(fake, windowId, h.placeholderBase);
  expect(ids).toEqual(Array.from({ length: bCount }, (_, i) => `B-t${i}`));
  expect(new Set(ids).size).toBe(ids.length); // no duplicates
  const aTabs = stored<WorkspaceTabs>(fake, Keys.wsTabs(h.aId));
  expect(aTabs?.tabs.map((t) => t.url)).toEqual(A_URLS);
  expect(stored(fake, Keys.opSwitch(windowId))).toBeUndefined();
  expect(stored<WindowState>(fake, Keys.window(windowId))?.activeWorkspaceId).toBe("B");
}

describe("WorkspaceEngine — happy path", () => {
  it("switches: saves outgoing, opens placeholders, closes outgoing, keeps pinned", async () => {
    const h = await world(3);
    const res = await h.ok("workspace.switch", { windowId: h.windowId, workspaceId: "B" });
    expect(res.skipped).toEqual([]);
    expectSwitched(h, 3);
    const active = h.fake.tabsOf(h.windowId).find((t) => t.active);
    expect(active && placeholderIds(h.fake, h.windowId, h.placeholderBase)[0]).toBe("B-t0");
    expect(h.fake.badges.get(active?.id ?? -1)).toBe("W"); // "WS B"
    expect(h.fake.calls.filter((c) => c === "tabs.create")).toHaveLength(3);
  });

  it("switches back with stable saved-tab ids (round trip)", async () => {
    const h = await world(3);
    const aBefore = stored<WorkspaceTabs>(h.fake, Keys.wsTabs(h.aId));
    await h.ok("workspace.switch", { windowId: h.windowId, workspaceId: "B" });
    await h.ok("workspace.switch", { windowId: h.windowId, workspaceId: h.aId });
    expect(unwrappedUrls(h.fake, h.windowId, h.placeholderBase)).toEqual(A_URLS);
    expect(placeholderIds(h.fake, h.windowId, h.placeholderBase)).toEqual(
      aBefore?.tabs.map((t) => t.id),
    );
    const b = stored<WorkspaceTabs>(h.fake, Keys.wsTabs("B"));
    expect(b?.tabs.map((t) => t.id)).toEqual(["B-t0", "B-t1", "B-t2"]);
    expect(b?.tabs.map((t) => t.url)).toEqual(bUrls(3));
  });

  it("chunks creation and advances createdTabIds per chunk", async () => {
    const persisted: number[] = [];
    const h = await world(23, {
      hooks: {
        checkpoint: (point, op) => {
          if (point.startsWith("chunk:")) persisted.push(Object.keys(op.createdTabIds).length);
        },
      },
    });
    await h.ok("workspace.switch", { windowId: h.windowId, workspaceId: "B" });
    expect(persisted).toEqual([10, 20, 23]);
    expectSwitched(h, 23);
  });

  it("re-creates tab groups", async () => {
    const h = await setup({
      windows: [["https://x.example/"]],
      before: (fake) =>
        seedWorkspace(fake, "G", [
          {
            url: "https://g.example/1",
            group: { id: "g1", title: "Grp", color: "green", collapsed: false },
          },
          {
            url: "https://g.example/2",
            group: { id: "g1", title: "Grp", color: "green", collapsed: false },
          },
          "https://g.example/3",
        ]),
      services: { debounceMs: 60_000 },
    });
    const w = h.fake.windowIds()[0] as number;
    await h.ok("workspace.switch", { windowId: w, workspaceId: "G" });
    const groups = h.fake.groupsOf(w);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ title: "Grp", color: "green" });
    const tabs = h.fake.tabsOf(w);
    expect(tabs.filter((t) => t.groupId === groups[0]?.id)).toHaveLength(2);
    // the window's previous tab went to an Unsorted workspace, not lost
    const index = stored<string[]>(h.fake, Keys.wsIndex) ?? [];
    const unsorted = index
      .map((id) => stored<WorkspaceMeta>(h.fake, Keys.wsMeta(id)))
      .find((m) => m?.kind === "unsorted");
    expect(unsorted).toBeDefined();
    expect(stored<WorkspaceTabs>(h.fake, Keys.wsTabs(unsorted?.id ?? ""))?.tabs[0]?.url).toBe(
      "https://x.example/",
    );
    // and the stored group survives the round trip back
    const g = stored<WorkspaceTabs>(h.fake, Keys.wsTabs("G"));
    expect(g?.tabs[0]?.group).toMatchObject({ title: "Grp", color: "green" });
  });

  it("empty target: creates a blank tab first, window never empty (I1)", async () => {
    const h = await world(0);
    await h.ok("workspace.switch", { windowId: h.windowId, workspaceId: "B" });
    const urls = h.fake.urlsOf(h.windowId);
    expect(urls).toEqual([PINNED, "about:blank"]);
    expect(stored<WorkspaceTabs>(h.fake, Keys.wsTabs(h.aId))?.tabs.map((t) => t.url)).toEqual(
      A_URLS,
    );
  });

  it("restore limit: overflow tabs are reported and kept as saved links", async () => {
    const h = await world(5);
    await h.ok("settings.update", { patch: { restoreLimit: 3 } });
    const res = await h.ok("workspace.switch", { windowId: h.windowId, workspaceId: "B" });
    expect(res.skipped.map((t) => t.url)).toEqual(bUrls(5).slice(3));
    expect(unwrappedUrls(h.fake, h.windowId, h.placeholderBase)).toEqual(bUrls(3));
    const meta = stored<WorkspaceMeta>(h.fake, Keys.wsMeta("B"));
    expect(meta?.resources.map((r) => r.url)).toEqual(bUrls(5).slice(3));
  });

  it("retained tabs (another extension's page) are neither saved nor closed", async () => {
    const other = "chrome-extension://otherextension/page.html";
    const h = await setup({
      windows: [["https://a.example/1", other]],
      before: (fake) => seedWorkspace(fake, "B", ["https://b.example/0"]),
      services: { debounceMs: 60_000 },
    });
    const w = h.fake.windowIds()[0] as number;
    const a = await h.ok("workspace.create", { name: "A", color: "red", fromWindowId: w });
    await h.ok("workspace.switch", { windowId: w, workspaceId: "B" });
    expect(h.fake.urlsOf(w)).toContain(other);
    expect(unwrappedUrls(h.fake, w, h.placeholderBase).sort()).toEqual(
      ["https://b.example/0", other].sort(),
    );
    expect(stored<WorkspaceTabs>(h.fake, Keys.wsTabs(a.id))?.tabs.map((t) => t.url)).toEqual([
      "https://a.example/1",
    ]);
    // switching back keeps it too, and B never captures it
    await h.ok("workspace.switch", { windowId: w, workspaceId: a.id });
    expect(h.fake.urlsOf(w)).toContain(other);
    expect(stored<WorkspaceTabs>(h.fake, Keys.wsTabs("B"))?.tabs.map((t) => t.url)).toEqual([
      "https://b.example/0",
    ]);
  });
});

describe("WorkspaceEngine — request validation", () => {
  it("same workspace -> invalid", async () => {
    const h = await world(1);
    const env = await h.rpc("workspace.switch", { windowId: h.windowId, workspaceId: h.aId });
    expect(env).toMatchObject({ ok: false, code: "invalid" });
  });

  it("concurrent switch on the same window -> busy", async () => {
    const h = await world(3);
    const first = h.rpc("workspace.switch", { windowId: h.windowId, workspaceId: "B" });
    const second = await h.rpc("workspace.switch", { windowId: h.windowId, workspaceId: "B" });
    expect(second).toMatchObject({ ok: false, code: "busy" });
    expect((await first).ok).toBe(true);
    expectSwitched(h, 3);
  });

  it("unknown workspace / window -> not_found", async () => {
    const h = await world(1);
    expect(
      await h.rpc("workspace.switch", { windowId: h.windowId, workspaceId: "nope" }),
    ).toMatchObject({ ok: false, code: "not_found" });
    expect(await h.rpc("workspace.switch", { windowId: 999, workspaceId: "B" })).toMatchObject({
      ok: false,
      code: "not_found",
    });
  });

  it("workspace already open in another window -> conflict", async () => {
    const h = await world(1);
    const w2 = h.fake.addWindow(["https://other.example/"]);
    await settle();
    const env = await h.rpc("workspace.switch", { windowId: w2, workspaceId: h.aId });
    expect(env).toMatchObject({ ok: false, code: "conflict" });
  });

  it("a pending (failed) op makes the window busy until resumed", async () => {
    const h = await world(3);
    h.fake.failNext("tabs.remove");
    const env = await h.rpc("workspace.switch", { windowId: h.windowId, workspaceId: "B" });
    expect(env).toMatchObject({ ok: false, code: "internal", retryable: true });
    expect(
      await h.rpc("workspace.switch", { windowId: h.windowId, workspaceId: "B" }),
    ).toMatchObject({
      ok: false,
      code: "busy",
    });
    await h.svc.engine.resumePending();
    expectSwitched(h, 3);
  });
});

describe("WorkspaceEngine — failure injection", () => {
  it("storage.set fails while writing the outgoing snapshot -> nothing closed, op rolled back", async () => {
    const h = await world(3);
    // a change so the outgoing snapshot must be written
    h.fake.openTab(h.windowId, "https://a.example/4");
    const before = h.fake.tabsOf(h.windowId).map((t) => t.id);
    h.fake.failNext("storage.set", {
      when: (items) => Object.keys(items as object).includes(Keys.wsTabs(h.aId)),
    });
    const env = await h.rpc("workspace.switch", { windowId: h.windowId, workspaceId: "B" });
    expect(env).toMatchObject({ ok: false, code: "internal" });
    expect(h.fake.tabsOf(h.windowId).map((t) => t.id)).toEqual(before);
    expect(h.fake.calls).not.toContain("tabs.remove");
    expect(h.fake.calls).not.toContain("tabs.create");
    expect(stored(h.fake, Keys.opSwitch(h.windowId))).toBeUndefined();
    // and a retry succeeds
    await h.ok("workspace.switch", { windowId: h.windowId, workspaceId: "B" });
    expect(stored<WorkspaceTabs>(h.fake, Keys.wsTabs(h.aId))?.tabs.map((t) => t.url)).toEqual([
      ...A_URLS,
      "https://a.example/4",
    ]);
  });

  it("storage.set fails on the op intent -> nothing happens", async () => {
    const h = await world(3);
    const before = h.fake.urlsOf(h.windowId);
    h.fake.failNext("storage.set", {
      when: (items) => Object.keys(items as object).includes(Keys.opSwitch(h.windowId)),
    });
    expect((await h.rpc("workspace.switch", { windowId: h.windowId, workspaceId: "B" })).ok).toBe(
      false,
    );
    expect(h.fake.urlsOf(h.windowId)).toEqual(before);
    expect(stored(h.fake, Keys.opSwitch(h.windowId))).toBeUndefined();
  });

  it("tabs.create fails mid-chunk -> op persists with progress; resume completes without duplicates", async () => {
    const h = await world(14);
    let n = 0;
    h.fake.failNext("tabs.create", { when: () => ++n === 13 });
    const env = await h.rpc("workspace.switch", { windowId: h.windowId, workspaceId: "B" });
    expect(env).toMatchObject({ ok: false, code: "internal" });
    const op = stored<SwitchOp>(h.fake, Keys.opSwitch(h.windowId));
    expect(op?.stage).toBe("opening");
    expect(Object.keys(op?.createdTabIds ?? {})).toHaveLength(12);
    // outgoing tabs untouched
    expect(h.fake.urlsOf(h.windowId)).toEqual(expect.arrayContaining([PINNED, ...A_URLS]));
    // resume via a worker restart (init replays the journal)
    await h.restart();
    expectSwitched(h, 14);
    expect(h.svc.initReport?.ops).toEqual([{ windowId: h.windowId, result: "resumed" }]);
  });

  it("tabs.create fails -> automatic resume via resumePending (alarm path)", async () => {
    const h = await world(3);
    h.fake.failNext("tabs.create");
    expect((await h.rpc("workspace.switch", { windowId: h.windowId, workspaceId: "B" })).ok).toBe(
      false,
    );
    await h.svc.onAlarm("flush-dirty");
    expectSwitched(h, 3);
  });

  it("tabs.remove meets a stale id -> still completes", async () => {
    const h = await world(3, {
      hooks: {
        checkpoint: (point, op) => {
          // an outgoing tab disappears right before the closing stage runs
          if (point === "persisted:closing") h.fake.closeTab(op.outgoingTabIds[1] as number);
        },
      },
    });
    await h.ok("workspace.switch", { windowId: h.windowId, workspaceId: "B" });
    expectSwitched(h, 3);
  });

  it("tabs.remove fails with a real error -> op persists at closing; resume completes", async () => {
    const h = await world(3);
    h.fake.failNext("tabs.remove", { when: (ids) => (ids as number[]).length === 1 });
    expect((await h.rpc("workspace.switch", { windowId: h.windowId, workspaceId: "B" })).ok).toBe(
      false,
    );
    expect(stored<SwitchOp>(h.fake, Keys.opSwitch(h.windowId))?.stage).toBe("closing");
    await h.restart();
    expectSwitched(h, 3);
  });

  it.each(["tabs.group", "tabs.update"] as const)("%s fails -> resume completes", async (op) => {
    const h = await setup({
      windows: [[...A_URLS]],
      before: (fake) =>
        seedWorkspace(fake, "B", [
          {
            url: "https://b.example/0",
            group: { id: "g", title: "G", color: "red", collapsed: false },
          },
          "https://b.example/1",
        ]),
      services: { debounceMs: 60_000 },
    });
    const w = h.fake.windowIds()[0] as number;
    await h.ok("workspace.create", { name: "A", color: "red", fromWindowId: w });
    h.fake.failNext(op);
    expect((await h.rpc("workspace.switch", { windowId: w, workspaceId: "B" })).ok).toBe(false);
    await h.restart();
    expect(unwrappedUrls(h.fake, w, h.placeholderBase)).toEqual([
      "https://b.example/0",
      "https://b.example/1",
    ]);
    expect(stored(h.fake, Keys.opSwitch(w))).toBeUndefined();
  });

  const KILL_POINTS = [
    "persisted:snapshot",
    "persisted:opening",
    "created:B-t3",
    "chunk:0",
    "created:B-t11",
    "persisted:activating",
    "persisted:closing",
    "persisted:done",
  ];

  it.each(KILL_POINTS)(
    "worker killed at %s -> after re-init the window has exactly the target tabs",
    async (point) => {
      let fired = false;
      const h = await world(12, {
        hooks: {
          checkpoint: (p) => {
            if (p === point && !fired) {
              fired = true;
              h.fake.killWorker();
            }
          },
        },
      });
      void h.rpc("workspace.switch", { windowId: h.windowId, workspaceId: "B" });
      await settle(10);
      expect(fired).toBe(true);
      expect(stored(h.fake, Keys.opSwitch(h.windowId))).toBeDefined();
      await h.restart({ services: { hooks: {} } });
      expectSwitched(h, 12);
      expect(h.svc.initReport?.ops[0]?.result).toBe("resumed");
      expect(stored<RecoveryPending>(h.fake, "recovery:pending")).toBeUndefined();
    },
  );

  it("browser restarted mid-switch -> op abandoned to recovery, nothing deleted", async () => {
    let fired = false;
    const h = await world(4, {
      hooks: {
        checkpoint: (p) => {
          if (p === "persisted:activating" && !fired) {
            fired = true;
            h.fake.killWorker();
          }
        },
      },
    });
    void h.rpc("workspace.switch", { windowId: h.windowId, workspaceId: "B" });
    await settle(10);
    const tabCount = h.fake.tabsOf(h.windowId).length;
    await h.restart({ browser: true, services: { hooks: {} } });
    expect(h.svc.initReport?.contextReset).toBe(true);
    expect(h.svc.initReport?.ops[0]?.result).toBe("abandoned");
    const rec = stored<RecoveryPending>(h.fake, "recovery:pending");
    expect(rec?.entries).toHaveLength(1);
    expect(rec?.entries[0]?.reason).toBe("session changed");
    expect(rec?.entries[0]?.incoming.map((t) => t.url)).toEqual(bUrls(4));
    expect(rec?.entries[0]?.fromSnapshot?.tabs.map((t) => t.url)).toEqual(A_URLS);
    // nothing deleted: both workspaces intact, every tab still open
    expect(stored<WorkspaceTabs>(h.fake, Keys.wsTabs(h.aId))?.tabs.map((t) => t.url)).toEqual(
      A_URLS,
    );
    expect(stored<WorkspaceTabs>(h.fake, Keys.wsTabs("B"))?.tabs.map((t) => t.url)).toEqual(
      bUrls(4),
    );
    const newWindow = h.fake.windowIds()[0] as number;
    expect(h.fake.tabsOf(newWindow)).toHaveLength(tabCount);
    expect(
      Object.keys(Object.fromEntries(h.fake.local)).filter((k) => k.startsWith("op:")),
    ).toEqual([]);
  });

  it("too many attempts -> abandoned", async () => {
    const h = await world(3);
    h.fake.failNext("tabs.create", 10);
    expect((await h.rpc("workspace.switch", { windowId: h.windowId, workspaceId: "B" })).ok).toBe(
      false,
    );
    for (let i = 0; i < 3; i++) {
      h.svc.engine.mayHavePendingOps = true;
      await h.svc.engine.resumePending();
    }
    h.svc.engine.mayHavePendingOps = true;
    await h.svc.engine.resumePending();
    expect(stored(h.fake, Keys.opSwitch(h.windowId))).toBeUndefined();
    const rec = stored<RecoveryPending>(h.fake, "recovery:pending");
    expect(rec?.entries[0]?.reason).toBe("too many attempts");
    // nothing closed
    expect(h.fake.urlsOf(h.windowId)).toEqual([PINNED, ...A_URLS]);
  });

  it("a created tab closed by the user before resume -> abandoned (canResume)", async () => {
    let fired = false;
    const h = await world(3, {
      hooks: {
        checkpoint: (p, op) => {
          if (p === "persisted:activating" && !fired) {
            fired = true;
            h.fake.killWorker();
            h.fake.closeTab(Object.values(op.createdTabIds)[0] as number);
          }
        },
      },
    });
    void h.rpc("workspace.switch", { windowId: h.windowId, workspaceId: "B" });
    await settle(10);
    await h.restart({ services: { hooks: {} } });
    expect(h.svc.initReport?.ops[0]?.result).toBe("abandoned");
    expect(h.fake.urlsOf(h.windowId)).toEqual(expect.arrayContaining([PINNED, ...A_URLS]));
  });

  it("tab id replaced (discard) during a switch is followed in the op", async () => {
    let fired = false;
    const h = await world(3, {
      hooks: {
        checkpoint: async (p, op) => {
          if (p === "persisted:closing" && !fired) {
            fired = true;
            const old = op.outgoingTabIds[0] as number;
            await h.fake.ports().tabs.discard(old);
            await settle();
            expect(op.outgoingTabIds).not.toContain(old);
          }
        },
      },
    });
    await h.ok("workspace.switch", { windowId: h.windowId, workspaceId: "B" });
    expectSwitched(h, 3);
  });
});

describe("WorkspaceEngine — other operations", () => {
  it("openInNewWindow: new window shows the workspace; no Unsorted created for it", async () => {
    const h = await world(2);
    const { windowId } = await h.ok("workspace.open", { workspaceId: "B" });
    expect(windowId).not.toBe(h.windowId);
    expect(unwrappedUrls(h.fake, windowId, h.placeholderBase)).toEqual(bUrls(2));
    expect(stored<WindowState>(h.fake, Keys.window(windowId))?.activeWorkspaceId).toBe("B");
    await h.svc.tracker.flush(windowId);
    const metas = (stored<string[]>(h.fake, Keys.wsIndex) ?? []).map((id) =>
      stored<WorkspaceMeta>(h.fake, Keys.wsMeta(id)),
    );
    expect(metas.filter((m) => m?.kind === "unsorted")).toHaveLength(0);
    // opening it again returns the same window
    expect(await h.ok("workspace.open", { workspaceId: "B" })).toEqual({ windowId });
    expect(await h.rpc("workspace.open", { workspaceId: "zzz" })).toMatchObject({
      code: "not_found",
    });
  });

  it("createWorkspace from a window folds the Unsorted workspace in; no tab closed", async () => {
    const h = await setup({ windows: [["https://u.example/1", "https://u.example/2"]] });
    const w = h.fake.windowIds()[0] as number;
    await h.svc.tracker.flush(w);
    const unsortedId = stored<WindowState>(h.fake, Keys.window(w))?.activeWorkspaceId as string;
    expect(stored<WorkspaceMeta>(h.fake, Keys.wsMeta(unsortedId))?.kind).toBe("unsorted");
    const meta = await h.ok("workspace.create", { name: "Mine", color: "green", fromWindowId: w });
    expect(stored<WindowState>(h.fake, Keys.window(w))?.activeWorkspaceId).toBe(meta.id);
    expect(stored(h.fake, Keys.wsMeta(unsortedId))).toBeUndefined();
    expect(stored<string[]>(h.fake, Keys.wsIndex)).toEqual([meta.id]);
    expect(stored<WorkspaceTabs>(h.fake, Keys.wsTabs(meta.id))?.tabs.map((t) => t.url)).toEqual([
      "https://u.example/1",
      "https://u.example/2",
    ]);
    expect(h.fake.urlsOf(w)).toHaveLength(2);
  });

  it("deleteWorkspace -> trash (window keeps its tabs); trash.restore brings it back", async () => {
    const h = await world(2);
    const { trashId } = await h.ok("workspace.delete", { id: h.aId });
    expect(stored(h.fake, Keys.wsMeta(h.aId))).toBeUndefined();
    expect(stored<WindowState>(h.fake, Keys.window(h.windowId))?.activeWorkspaceId).toBeNull();
    expect(h.fake.urlsOf(h.windowId)).toEqual([PINNED, ...A_URLS]);
    await h.ok("trash.restore", { trashId });
    expect(stored<WorkspaceMeta>(h.fake, Keys.wsMeta(h.aId))?.name).toBe("A");
    expect(stored<WorkspaceTabs>(h.fake, Keys.wsTabs(h.aId))?.tabs.map((t) => t.url)).toEqual(
      A_URLS,
    );
    expect(await h.rpc("workspace.delete", { id: "nope" })).toMatchObject({ code: "not_found" });
  });

  it("delete refuses a workspace with a pending op", async () => {
    const h = await world(2);
    h.fake.failNext("tabs.create");
    await h.rpc("workspace.switch", { windowId: h.windowId, workspaceId: "B" });
    expect(await h.rpc("workspace.delete", { id: "B" })).toMatchObject({ code: "busy" });
  });

  it("nextWorkspace cycles named workspaces", async () => {
    const h = await world(1);
    const r1 = await h.ok("workspace.next", { windowId: h.windowId, direction: 1 });
    expect(r1.workspaceId).toBe("B");
    const r2 = await h.ok("workspace.next", { windowId: h.windowId, direction: 1 });
    expect(r2.workspaceId).toBe(h.aId);
    const r3 = await h.ok("workspace.next", { windowId: h.windowId, direction: -1 });
    expect(r3.workspaceId).toBe("B");
  });

  it("nextWorkspace with a single workspace is a no-op", async () => {
    const h = await setup({ windows: [["https://x.example/"]] });
    const w = h.fake.windowIds()[0] as number;
    expect(await h.ok("workspace.next", { windowId: w, direction: 1 })).toEqual({
      workspaceId: null,
    });
    await h.ok("workspace.create", { name: "Only", color: "blue", fromWindowId: w });
    expect(await h.ok("workspace.next", { windowId: w, direction: 1 })).toEqual({
      workspaceId: null,
    });
  });

  it("op.status reports the running op", async () => {
    let seen: unknown = "unset";
    const h = await world(2, {
      hooks: {
        checkpoint: async (p) => {
          if (p === "persisted:opening") {
            const env = await h.rpc("op.status", { windowId: h.windowId });
            seen = env.ok ? structuredClone(env.value) : null;
          }
        },
      },
    });
    await h.ok("workspace.switch", { windowId: h.windowId, workspaceId: "B" });
    expect(seen).toMatchObject({ to: "B", stage: "opening" });
    expect(await h.ok("op.status", { windowId: h.windowId })).toBeNull();
  });
});

// ---------------------------------------------------------------- review fixes (A, B, E, G, J, L, M, N, P)

const opOf = (h: Harness, w: number) => stored<SwitchOp>(h.fake, Keys.opSwitch(w));

describe("WorkspaceEngine — closing revalidates outgoing tabs (A)", () => {
  it("a tab navigated during a stalled closing is saved (same SavedTab id) before it closes", async () => {
    const h = await world(3);
    const before = stored<WorkspaceTabs>(h.fake, Keys.wsTabs(h.aId));
    h.fake.failNext("tabs.remove");
    expect((await h.rpc("workspace.switch", { windowId: h.windowId, workspaceId: "B" })).ok).toBe(
      false,
    );
    const op = opOf(h, h.windowId);
    expect(op?.stage).toBe("closing");
    expect(Object.keys(op?.outgoingSavedIds ?? {})).toHaveLength(3);
    const moved = op?.outgoingTabIds[1] as number;
    h.fake.navigate(moved, "https://a.example/changed", "Changed");
    await settle();
    await h.restart();
    const after = stored<WorkspaceTabs>(h.fake, Keys.wsTabs(h.aId));
    expect(after?.tabs.map((t) => t.url)).toEqual([
      "https://a.example/1",
      "https://a.example/changed",
      "https://a.example/3",
    ]);
    expect(after?.tabs.map((t) => t.id)).toEqual(before?.tabs.map((t) => t.id));
    expect(after?.tabs[1]?.title).toBe("Changed");
    expect(h.fake.hasTab(moved)).toBe(false);
    expect(unwrappedUrls(h.fake, h.windowId, h.placeholderBase)).toEqual(bUrls(3));
  });

  it("tabs pinned or moved to another window during a stalled closing are retained", async () => {
    const h = await world(3);
    const other = h.fake.addWindow(["https://elsewhere.example/"]);
    h.fake.failNext("tabs.remove");
    await h.rpc("workspace.switch", { windowId: h.windowId, workspaceId: "B" });
    const [t0, t1, t2] = (opOf(h, h.windowId)?.outgoingTabIds ?? []) as [number, number, number];
    h.fake.moveTab(t0, other);
    h.fake.setPinned(t1, true);
    await settle();
    await h.restart();
    expect(opOf(h, h.windowId)).toBeUndefined();
    expect(h.fake.tab(t0)?.windowId).toBe(other);
    expect(h.fake.tab(t1)?.pinned).toBe(true);
    expect(h.fake.hasTab(t2)).toBe(false);
  });

  it("a blank outgoing tab that got content is appended to the outgoing workspace", async () => {
    const h = await setup({
      windows: [["https://a.example/1", "about:blank"]],
      before: (fake) => seedWorkspace(fake, "B", ["https://b.example/"]),
      services: { debounceMs: 60_000 },
    });
    const w = h.fake.windowIds()[0] as number;
    const a = await h.ok("workspace.create", { name: "A", color: "red", fromWindowId: w });
    h.fake.failNext("tabs.remove");
    await h.rpc("workspace.switch", { windowId: w, workspaceId: "B" });
    const blank = opOf(h, w)?.outgoingTabIds[1] as number;
    h.fake.navigate(blank, "https://late.example/");
    await settle();
    await h.restart();
    expect(stored<WorkspaceTabs>(h.fake, Keys.wsTabs(a.id))?.tabs.map((t) => t.url)).toEqual([
      "https://a.example/1",
      "https://late.example/",
    ]);
  });
});

describe("WorkspaceEngine — pending navigations, ids, own pages (B, E, P)", () => {
  it("a blank tab with a pending navigation is saved as its destination, not discarded", async () => {
    const h = await setup({
      windows: [["https://a.example/1", "about:blank"]],
      before: (fake) => seedWorkspace(fake, "B", ["https://b.example/"]),
      services: { debounceMs: 60_000 },
    });
    const w = h.fake.windowIds()[0] as number;
    const a = await h.ok("workspace.create", { name: "A", color: "red", fromWindowId: w });
    const blank = h.fake.tabsOf(w)[1]?.id as number;
    h.fake.navigate(blank, "https://slow.example/article", { commit: false });
    await h.ok("workspace.switch", { windowId: w, workspaceId: "B" });
    expect(stored<WorkspaceTabs>(h.fake, Keys.wsTabs(a.id))?.tabs.map((t) => t.url)).toEqual([
      "https://a.example/1",
      "https://slow.example/article",
    ]);
  });

  it("saved-tab ids like 'constructor' are restored (no prototype lookups)", async () => {
    const h = await setup({
      windows: [["https://x.example/"]],
      before: (fake) =>
        seedWorkspace(fake, "B", [
          { id: "constructor", url: "https://b.example/0" },
          { id: "toString", url: "https://b.example/1" },
        ]),
      services: { debounceMs: 60_000 },
    });
    const w = h.fake.windowIds()[0] as number;
    await h.ok("workspace.switch", { windowId: w, workspaceId: "B" });
    expect(placeholderIds(h.fake, w, h.placeholderBase)).toEqual(["constructor", "toString"]);
  });

  it("our own extension pages are saved and restored, not retained", async () => {
    const own = "chrome-extension://fakeextensionid/";
    const h = await setup({
      windows: [["https://a.example/", `${own}dashboard.html`]],
      before: (fake) => seedWorkspace(fake, "B", ["https://b.example/"]),
      services: { debounceMs: 60_000 },
    });
    const w = h.fake.windowIds()[0] as number;
    const a = await h.ok("workspace.create", { name: "A", color: "red", fromWindowId: w });
    await h.ok("workspace.switch", { windowId: w, workspaceId: "B" });
    expect(stored<WorkspaceTabs>(h.fake, Keys.wsTabs(a.id))?.tabs.map((t) => t.url)).toEqual([
      "https://a.example/",
      `${own}dashboard.html`,
    ]);
    expect(h.fake.urlsOf(w).some((u) => u.endsWith("dashboard.html"))).toBe(false);
    await h.ok("workspace.switch", { windowId: w, workspaceId: a.id });
    expect(h.fake.urlsOf(w)).toContain(`${own}dashboard.html`);
  });
});

describe("WorkspaceEngine — lost results after a worker death (J)", () => {
  it("tabs.create done browser-side, result lost: resume adopts the placeholder (no duplicate)", async () => {
    const h = await world(3);
    h.fake.failAfterEffect("tabs.create", {
      when: (spec) => (spec as { url: string }).url.includes("s=B-t1"),
    });
    void h.rpc("workspace.switch", { windowId: h.windowId, workspaceId: "B" });
    await settle(10);
    expect(opOf(h, h.windowId)?.stage).toBe("opening");
    await h.restart();
    expectSwitched(h, 3);
  });

  it("a lost direct-created tab is duplicated once, then closed by the post-resume dedupe", async () => {
    const urls = ["https://b.example/0", "chrome://settings/", "https://b.example/2"];
    const h = await setup({
      windows: [[...A_URLS]],
      before: (fake) => seedWorkspace(fake, "B", urls),
      services: { debounceMs: 60_000 },
    });
    const w = h.fake.windowIds()[0] as number;
    await h.ok("workspace.create", { name: "A", color: "red", fromWindowId: w });
    h.fake.failAfterEffect("tabs.create", {
      when: (spec) => (spec as { url: string }).url === "chrome://settings/",
    });
    void h.rpc("workspace.switch", { windowId: w, workspaceId: "B" });
    await settle(10);
    await h.restart();
    expect(unwrappedUrls(h.fake, w, h.placeholderBase)).toEqual(urls);
    expect(stored(h.fake, Keys.opSwitch(w))).toBeUndefined();
    expect(stored<ClosedTab[]>(h.fake, Keys.recentlyClosed) ?? []).toEqual([]);
  });
});

describe("WorkspaceEngine — journal serialization (G)", () => {
  it("a failed stage-transition write keeps the op at its stage; the alarm rediscovers it", async () => {
    const h = await world(3);
    h.fake.failNext("storage.set", {
      when: (items) => {
        const op = (items as Record<string, SwitchOp>)[Keys.opSwitch(h.windowId)];
        return op?.stage === "activating";
      },
    });
    expect((await h.rpc("workspace.switch", { windowId: h.windowId, workspaceId: "B" })).ok).toBe(
      false,
    );
    expect(opOf(h, h.windowId)?.stage).toBe("opening");
    h.svc.engine.mayHavePendingOps = false; // a fresh worker would not have the flag either
    h.fake.fireAlarm("flush-dirty");
    await settle(20);
    expectSwitched(h, 3);
  });

  it("a stalled op's id patch is laned and re-read; a committed op is never resurrected", async () => {
    const h = await world(3);
    h.fake.failNext("tabs.create");
    await h.rpc("workspace.switch", { windowId: h.windowId, workspaceId: "B" });
    const old = opOf(h, h.windowId)?.outgoingTabIds[1] as number;
    await h.fake.ports().tabs.discard(old);
    await settle(10);
    const patched = opOf(h, h.windowId);
    expect(patched?.outgoingTabIds).not.toContain(old);
    expect(patched?.outgoingSavedIds?.[patched.outgoingTabIds[1] as number]).toBeDefined();
    await h.svc.engine.resumePending();
    expectSwitched(h, 3);
    // a late replacement for a committed op writes nothing
    await h.svc.engine.onTabReplaced(77_777, patched?.outgoingTabIds[1] as number);
    expect(opOf(h, h.windowId)).toBeUndefined();
  });
});

describe("WorkspaceEngine — abandon, ownership, closed-by-switch (L, M, N)", () => {
  it("abandon detaches the window: `to` placeholders never contaminate `from` (L)", async () => {
    let fired = false;
    const h = await world(3, {
      hooks: {
        checkpoint: (p, op) => {
          if (p === "persisted:activating" && !fired) {
            fired = true;
            h.fake.killWorker();
            h.fake.closeTab(op.outgoingTabIds[0] as number); // makes canResume abandon
          }
        },
      },
    });
    void h.rpc("workspace.switch", { windowId: h.windowId, workspaceId: "B" });
    await settle(10);
    await h.restart({ services: { hooks: {} } });
    expect(h.svc.initReport?.ops[0]?.result).toBe("abandoned");
    const rec = stored<RecoveryPending>(h.fake, "recovery:pending")?.entries[0];
    expect(rec).toMatchObject({ from: h.aId, to: "B" });
    expect(rec?.incoming.map((t) => t.url)).toEqual(bUrls(3));
    await h.svc.tracker.flush(h.windowId);
    expect(stored<WorkspaceTabs>(h.fake, Keys.wsTabs(h.aId))?.tabs.map((t) => t.url)).toEqual(
      A_URLS,
    );
    const st = stored<WindowState>(h.fake, Keys.window(h.windowId));
    expect(st?.activeWorkspaceId).not.toBe(h.aId);
    const unsorted = stored<WorkspaceTabs>(h.fake, Keys.wsTabs(st?.activeWorkspaceId ?? ""));
    expect(unsorted?.tabs.map((t) => t.url)).toEqual(expect.arrayContaining(bUrls(3)));
  });

  it("ownerOf ignores windows:* records from another epoch (M)", async () => {
    const h = await world(2);
    const other = h.fake.addWindow(["https://o.example/"]);
    // a stale record (previous browser session) naming a reused, live window id
    h.fake.local.set(Keys.window(other), { activeWorkspaceId: "B", sessionEpoch: "old" });
    expect(await h.svc.engine.ownerOf("B")).toBeNull();
    await h.ok("workspace.switch", { windowId: h.windowId, workspaceId: "B" });
    expectSwitched(h, 2);
  });

  it("removals a previous worker's switch caused are recognized after a restart (N)", async () => {
    const h = await world(3);
    const outgoing = [...h.fake.tabsOf(h.windowId)].filter((t) => !t.pinned).map((t) => t.id);
    await h.ok("workspace.switch", { windowId: h.windowId, workspaceId: "B" });
    await h.restart();
    for (const id of outgoing) {
      expect(await h.svc.engine.wasClosedBySwitch(id, h.windowId)).toBe(true);
    }
    expect(await h.svc.engine.wasClosedBySwitch(424_242, h.windowId)).toBe(false);
    expect(stored<ClosedTab[]>(h.fake, Keys.recentlyClosed)).toEqual([]);
  });
});
