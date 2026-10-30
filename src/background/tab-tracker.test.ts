import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ClosedTab,
  SwitchOp,
  Trash,
  WindowState,
  WorkspaceMeta,
  WorkspaceTabs,
} from "../core/model/types";
import { Keys, LIMITS } from "../core/model/types";
import { BgKeys } from "./keys";
import { type Harness, seedWorkspace, setup, stored } from "./testing/harness";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
});
afterEach(() => {
  vi.useRealTimers();
});

const tick = (ms = 0) => vi.advanceTimersByTimeAsync(ms);

async function named(urls: string[]): Promise<Harness & { w: number; wsId: string }> {
  const h = await setup({ windows: [urls] });
  const w = h.fake.windowIds()[0] as number;
  const meta = await h.ok("workspace.create", { name: "N", color: "blue", fromWindowId: w });
  await tick(1000);
  return Object.assign(h, { w, wsId: meta.id });
}

function validOp(windowId: number, from: string, epoch: string): SwitchOp {
  return {
    id: "op1",
    windowId,
    from,
    to: "B",
    stage: "opening",
    sessionEpoch: epoch,
    outgoingTabIds: [],
    createdTabIds: {},
    incoming: [{ id: "s1", url: "https://b.example/", title: "B", index: 0 }],
    skipped: [],
    startedAt: 0,
    attempts: 0,
  };
}

const tabsOf = (h: Harness, id: string) =>
  stored<WorkspaceTabs>(h.fake, Keys.wsTabs(id))?.tabs.map((t) => t.url);

describe("TabTracker", () => {
  it("debounces events into one snapshot write, with a durable dirty marker", async () => {
    const h = await named(["https://a.example/"]);
    const writes = () => h.fake.calls.filter((c) => c === "storage.set").length;
    const before = writes();
    h.fake.openTab(h.w, "https://b.example/");
    h.fake.openTab(h.w, "https://c.example/");
    await tick(10);
    expect(stored(h.fake, Keys.dirty(h.w))).toBeDefined();
    expect(tabsOf(h, h.wsId)).toEqual(["https://a.example/"]);
    await tick(400);
    h.fake.navigate(h.fake.tabsOf(h.w)[2]?.id as number, "https://c.example/2");
    await tick(749);
    expect(tabsOf(h, h.wsId)).toEqual(["https://a.example/"]);
    await tick(10);
    expect(tabsOf(h, h.wsId)).toEqual([
      "https://a.example/",
      "https://b.example/",
      "https://c.example/2",
    ]);
    expect(stored(h.fake, Keys.dirty(h.w))).toBeUndefined();
    // one dirty marker + one snapshot
    expect(writes() - before).toBe(2);
  });

  it("caps the debounce at maxWait under a constant event stream", async () => {
    const h = await named(["https://a.example/"]);
    const id = h.fake.tabsOf(h.w)[0]?.id as number;
    for (let i = 0; i < 12; i++) {
      h.fake.navigate(id, `https://a.example/${i}`);
      await tick(500);
    }
    expect(tabsOf(h, h.wsId)?.[0]).not.toBe("https://a.example/");
  });

  it("flushes immediately on tab removal and records it as recently closed", async () => {
    const h = await named(["https://a.example/", "https://b.example/"]);
    const b = h.fake.tabsOf(h.w)[1]?.id as number;
    h.fake.closeTab(b);
    await tick(0);
    expect(tabsOf(h, h.wsId)).toEqual(["https://a.example/"]);
    const rc = stored<ClosedTab[]>(h.fake, Keys.recentlyClosed);
    expect(rc?.[0]).toMatchObject({ url: "https://b.example/", workspaceId: h.wsId });
  });

  it("does not record tabs closed by a switch", async () => {
    const h = await named(["https://a.example/"]);
    seedWorkspace(h.fake, "B", ["https://b.example/"]);
    await h.ok("workspace.switch", { windowId: h.w, workspaceId: "B" });
    await tick(1000);
    expect(stored<ClosedTab[]>(h.fake, Keys.recentlyClosed)).toEqual([]);
  });

  it("skips windows with an op record (I4)", async () => {
    const h = await named(["https://a.example/"]);
    h.fake.local.set(Keys.opSwitch(h.w), validOp(h.w, h.wsId, h.svc.ctx.epoch));
    expect(await h.svc.tracker.snapshotNow(h.w)).toBe("locked");
    // an invalid op record is quarantined (kept under corrupt:) instead of blocking forever
    h.fake.local.set(Keys.opSwitch(h.w), { stage: "opening" });
    expect(await h.svc.tracker.snapshotNow(h.w)).toBe("same");
    expect(stored(h.fake, `corrupt:${Keys.opSwitch(h.w)}`)).toMatchObject({
      raw: { stage: "opening" },
    });
  });

  it("creates an implicit Unsorted workspace for an untracked window", async () => {
    const h = await setup({ windows: [["https://x.example/"]] });
    const w = h.fake.windowIds()[0] as number;
    h.fake.openTab(w, "https://y.example/");
    await tick(1000);
    const st = stored<WindowState>(h.fake, Keys.window(w));
    const meta = stored<WorkspaceMeta>(h.fake, Keys.wsMeta(st?.activeWorkspaceId ?? ""));
    expect(meta).toMatchObject({ kind: "unsorted", name: `Unsorted (window ${w})` });
    expect(tabsOf(h, meta?.id ?? "")).toEqual(["https://x.example/", "https://y.example/"]);
    expect(stored<string[]>(h.fake, Keys.wsIndex)).toContain(meta?.id);
  });

  it("does not create an Unsorted workspace for a window with nothing to save", async () => {
    const h = await setup({ windows: [[{ url: "https://p.example/", pinned: true }]] });
    const w = h.fake.windowIds()[0] as number;
    expect(await h.svc.tracker.snapshotNow(w)).toBe("empty");
    expect(stored<string[]>(h.fake, Keys.wsIndex)).toEqual([]);
  });

  it("window closed: Unsorted tabs -> recently closed, Unsorted deleted", async () => {
    const h = await setup({ windows: [["https://x.example/", "https://y.example/"]] });
    const w = h.fake.windowIds()[0] as number;
    await h.svc.tracker.flush(w);
    const wsId = stored<WindowState>(h.fake, Keys.window(w))?.activeWorkspaceId as string;
    h.fake.closeWindow(w);
    await tick(0);
    expect(stored(h.fake, Keys.wsMeta(wsId))).toBeUndefined();
    expect(stored(h.fake, Keys.wsTabs(wsId))).toBeUndefined();
    expect(stored(h.fake, Keys.window(w))).toBeUndefined();
    expect(stored<string[]>(h.fake, Keys.wsIndex)).toEqual([]);
    expect(
      stored<ClosedTab[]>(h.fake, Keys.recentlyClosed)
        ?.map((t) => t.url)
        .sort(),
    ).toEqual(["https://x.example/", "https://y.example/"]);
    // and the whole workspace is restorable from the trash (recentlyClosed is capped)
    const trash = stored<Trash>(h.fake, Keys.trash);
    expect(trash?.items[0]).toMatchObject({ kind: "workspace", meta: { id: wsId } });
  });

  it("window closed: a named workspace stays intact", async () => {
    const h = await named(["https://a.example/", "https://b.example/"]);
    h.fake.closeWindow(h.w);
    await tick(0);
    expect(tabsOf(h, h.wsId)).toEqual(["https://a.example/", "https://b.example/"]);
    expect(stored(h.fake, Keys.wsMeta(h.wsId))).toBeDefined();
    expect(stored<ClosedTab[]>(h.fake, Keys.recentlyClosed)).toEqual([]);
  });

  it("window closed mid-switch: op abandoned to recovery (nothing deleted)", async () => {
    const h = await named(["https://a.example/"]);
    h.fake.local.set(Keys.opSwitch(h.w), validOp(h.w, h.wsId, h.svc.ctx.epoch));
    h.fake.closeWindow(h.w);
    await tick(0);
    expect(stored(h.fake, Keys.opSwitch(h.w))).toBeUndefined();
    expect(stored<{ entries: unknown[] }>(h.fake, BgKeys.recoveryPending)?.entries).toHaveLength(1);
  });

  it("recently closed is capped and newest first", async () => {
    const h = await named(["https://keep.example/"]);
    for (let i = 0; i < LIMITS.recentlyClosed + 5; i++) {
      const id = h.fake.openTab(h.w, `https://r.example/${i}`);
      await tick(0);
      h.fake.closeTab(id);
      await tick(0);
    }
    const rc = stored<ClosedTab[]>(h.fake, Keys.recentlyClosed) ?? [];
    expect(rc).toHaveLength(LIMITS.recentlyClosed);
    expect(rc[0]?.url).toBe(`https://r.example/${LIMITS.recentlyClosed + 4}`);
  });

  it("follows tabs.onReplaced: a discarded tab closed later is still recorded", async () => {
    const h = await named(["https://a.example/", "https://b.example/"]);
    const b = h.fake.tabsOf(h.w)[1]?.id as number;
    await h.fake.ports().tabs.discard(b);
    await tick(0);
    const replaced = h.fake.tabsOf(h.w)[1]?.id as number;
    expect(replaced).not.toBe(b);
    h.fake.closeTab(replaced);
    await tick(0);
    expect(stored<ClosedTab[]>(h.fake, Keys.recentlyClosed)?.[0]?.url).toBe("https://b.example/");
  });

  it("recently closed falls back to the storage.session cache after a worker restart", async () => {
    const h = await named(["https://a.example/", "https://b.example/"]);
    await h.svc.tracker.flush(h.w);
    const b = h.fake.tabsOf(h.w)[1]?.id as number;
    expect(stored(h.fake, Keys.recentlyClosed)).toEqual([]);
    // the worker is killed; the removal event is what wakes the new one, before init's getAll
    h.fake.killWorker();
    const svc = (await import("./services")).createServices(h.fake.ports(), {
      ...h.opts,
    });
    svc.start();
    h.fake.closeTab(b);
    await svc.init();
    await tick(0);
    expect(stored<ClosedTab[]>(h.fake, Keys.recentlyClosed)?.[0]?.url).toBe("https://b.example/");
  });

  it("a killed worker's dirty window is flushed by the next init", async () => {
    const h = await named(["https://a.example/"]);
    h.fake.openTab(h.w, "https://late.example/");
    await tick(10); // marked dirty, debounce pending
    expect(stored(h.fake, Keys.dirty(h.w))).toBeDefined();
    await h.restart();
    expect(h.svc.initReport?.flushed).toEqual([h.w]);
    expect(tabsOf(h, h.wsId)).toEqual(["https://a.example/", "https://late.example/"]);
    expect(stored(h.fake, Keys.dirty(h.w))).toBeUndefined();
  });

  it("flush-dirty alarm flushes pending windows", async () => {
    const h = await named(["https://a.example/"]);
    h.fake.openTab(h.w, "https://b.example/");
    await tick(10);
    h.fake.fireAlarm("flush-dirty");
    await tick(0);
    expect(tabsOf(h, h.wsId)).toEqual(["https://a.example/", "https://b.example/"]);
  });

  it("snapshot write failure keeps the window dirty for a retry", async () => {
    const h = await named(["https://a.example/"]);
    h.fake.openTab(h.w, "https://b.example/");
    await tick(10);
    h.fake.failNext("storage.set", {
      when: (items) => Object.keys(items as object).includes(Keys.wsTabs(h.wsId)),
    });
    await tick(1000);
    expect(h.svc.tracker.isDirty(h.w)).toBe(true);
    expect(stored(h.fake, Keys.dirty(h.w))).toBeDefined();
    await h.svc.tracker.flushAll();
    expect(tabsOf(h, h.wsId)).toEqual(["https://a.example/", "https://b.example/"]);
  });

  it("drops data: favicons instead of corrupting the snapshot", async () => {
    const h = await setup({
      windows: [[{ url: "https://a.example/", favIconUrl: "data:image/png;base64,AAAA" }]],
    });
    const w = h.fake.windowIds()[0] as number;
    await h.svc.tracker.flush(w);
    const wsId = stored<WindowState>(h.fake, Keys.window(w))?.activeWorkspaceId as string;
    const tabs = stored<WorkspaceTabs>(h.fake, Keys.wsTabs(wsId));
    expect(tabs?.tabs[0]?.favIconUrl).toBeUndefined();
    expect(await h.svc.repo.getWorkspaceTabs(wsId)).not.toBeNull();
  });

  it("activation, moves, groups and attach mark the window dirty", async () => {
    const h = await named(["https://a.example/", "https://b.example/"]);
    const ids = h.fake.tabsOf(h.w).map((t) => t.id);
    h.fake.activate(ids[1] as number);
    await tick(0);
    expect(h.svc.tracker.isDirty(h.w)).toBe(true);
    await tick(1000);
    expect(stored<WorkspaceTabs>(h.fake, Keys.wsTabs(h.wsId))?.activeSavedTabId).toBe(
      stored<WorkspaceTabs>(h.fake, Keys.wsTabs(h.wsId))?.tabs[1]?.id,
    );
    await h.fake.ports().tabs.group([ids[0] as number], h.w);
    await tick(0);
    expect(h.svc.tracker.isDirty(h.w)).toBe(true);
    h.svc.tracker.stop();
  });
});
