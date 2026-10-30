import { describe, expect, it } from "vitest";
import type { SavedTab, SwitchOp } from "../model/types";
import { LIMITS } from "../model/types";
import { BASE, liveWindow, NOW, rng, savedTab, seqIds, workspaceTabs } from "../testing/fixtures";
import {
  BLANK_SAVED_TAB_ID,
  BLANK_TAB_URL,
  canResume,
  MAX_SWITCH_ATTEMPTS,
  nextStage,
  PlanError,
  planOpening,
  planSwitch,
} from "./switch-planner";
import type { SwitchPlannerInput } from "./types";
import { buildPlaceholderUrl, parsePlaceholderUrl } from "./url";

function input(over: Partial<SwitchPlannerInput> = {}): SwitchPlannerInput {
  return {
    window: liveWindow([
      { id: 1, url: "https://pinned.com", pinned: true },
      { id: 2, url: "https://out-a.com", active: true },
      { id: 3, url: "https://out-b.com" },
    ]),
    from: "wsA",
    to: "wsB",
    fromTabs: null,
    toTabs: workspaceTabs([
      savedTab({ id: "b1", url: "https://b1.com", title: "B1" }),
      savedTab({ id: "b2", url: "chrome://settings" }),
      savedTab({ id: "b3", url: "https://b3.com" }),
    ]),
    sessionEpoch: "epoch-1",
    now: NOW,
    restoreLimit: 100,
    placeholderBase: BASE,
    newId: seqIds(),
    ...over,
  };
}

const specs = (p: ReturnType<typeof planSwitch>) => p.opening.chunks.flat();

describe("planSwitch", () => {
  it("builds the op record", () => {
    const plan = planSwitch(input({ toTabs: { ...input().toTabs, activeSavedTabId: "b3" } }));
    expect(plan.op).toMatchObject({
      windowId: 1,
      from: "wsA",
      to: "wsB",
      stage: "snapshot",
      sessionEpoch: "epoch-1",
      outgoingTabIds: [2, 3],
      createdTabIds: {},
      skipped: [],
      startedAt: NOW,
      attempts: 0,
      activeSavedTabId: "b3",
    });
    expect(plan.op.id).toMatch(/^id-/);
    expect(plan.op.incoming.map((t) => t.id)).toEqual(["b1", "b2", "b3"]);
  });

  it("freezes a deep copy of the incoming tabs", () => {
    const tabs = [
      savedTab({
        id: "g",
        url: "https://g.com",
        group: { id: "G", title: "", color: "red", collapsed: false },
      }),
    ];
    const plan = planSwitch(input({ toTabs: workspaceTabs(tabs) }));
    expect(plan.op.incoming[0]).toEqual(workspaceTabs(tabs).tabs[0]);
    expect(plan.op.incoming[0]).not.toBe(tabs[0]);
    expect(plan.op.incoming[0]?.group).not.toBe(tabs[0]?.group);
  });

  it("snapshots the outgoing window (pinned excluded)", () => {
    const plan = planSwitch(input());
    expect(plan.outgoingSnapshot?.tabs.map((t) => t.url)).toEqual([
      "https://out-a.com",
      "https://out-b.com",
    ]);
    expect(plan.outgoingSnapshot?.rev).toBe(1);
  });

  it("outgoing snapshot is null only when from is null and the window has no unpinned tabs", () => {
    const pinnedOnly = liveWindow([{ url: "https://p.com", pinned: true }]);
    expect(planSwitch(input({ from: null, window: pinnedOnly })).outgoingSnapshot).toBeNull();
    expect(planSwitch(input({ from: "wsA", window: pinnedOnly })).outgoingSnapshot).toEqual({
      tabs: [],
      updatedAt: NOW,
      rev: 1,
    });
    expect(planSwitch(input({ from: null })).outgoingSnapshot?.tabs).toHaveLength(2);
  });

  it("creates placeholders / direct tabs after the pinned tabs", () => {
    const s = specs(planSwitch(input()));
    expect(s.map((x) => [x.savedTabId, x.mode, x.index, x.active])).toEqual([
      ["b1", "placeholder", 1, true],
      ["b2", "direct", 2, false],
      ["b3", "placeholder", 3, false],
    ]);
    expect(s[1]?.url).toBe("chrome://settings");
    expect(parsePlaceholderUrl(s[0]?.url ?? "", BASE)).toEqual({
      u: "https://b1.com",
      t: "B1",
      w: "wsB",
      s: "b1",
    });
  });

  it("restores in saved index order", () => {
    const toTabs = workspaceTabs([savedTab({ id: "x" }), savedTab({ id: "y" })]);
    toTabs.tabs.reverse();
    expect(specs(planSwitch(input({ toTabs }))).map((s) => s.savedTabId)).toEqual(["x", "y"]);
  });

  it("skips unrestorable tabs and tabs beyond restoreLimit", () => {
    const toTabs = workspaceTabs([
      savedTab({ id: "ok1" }),
      savedTab({ id: "bad", url: "chrome-extension://x/y.html" }),
      savedTab({ id: "ok2" }),
      savedTab({ id: "over" }),
    ]);
    const plan = planSwitch(input({ toTabs, restoreLimit: 2 }));
    expect(specs(plan).map((s) => s.savedTabId)).toEqual(["ok1", "ok2"]);
    expect(plan.opening.skipped.map((t) => t.id)).toEqual(["bad", "over"]);
    expect(plan.op.skipped.map((t) => t.id)).toEqual(["bad", "over"]);
  });

  it("activates the saved active tab only if it is restored, else the first", () => {
    const toTabs = workspaceTabs([savedTab({ id: "a" }), savedTab({ id: "b" })], {
      activeSavedTabId: "b",
    });
    expect(specs(planSwitch(input({ toTabs, restoreLimit: 1 }))).map((s) => s.active)).toEqual([
      true,
    ]);
    expect(specs(planSwitch(input({ toTabs }))).map((s) => s.active)).toEqual([false, true]);
  });

  it("chunks by LIMITS.restoreChunk", () => {
    const tabs = Array.from({ length: 23 }, (_, i) => savedTab({ id: `t${i}` }));
    const plan = planSwitch(input({ toTabs: workspaceTabs(tabs) }));
    expect(plan.opening.chunks.map((c) => c.length)).toEqual([
      LIMITS.restoreChunk,
      LIMITS.restoreChunk,
      3,
    ]);
    expect(specs(plan).map((s) => s.index)).toEqual(tabs.map((_, i) => i + 1));
  });

  it("groups consecutive tabs with the same group id", () => {
    const g1 = { id: "g1", title: "One", color: "red" as const, collapsed: true };
    const g2 = { id: "g2", title: "Two", color: "blue" as const, collapsed: false };
    const toTabs = workspaceTabs([
      savedTab({ id: "a", group: g1 }),
      savedTab({ id: "b", group: g1 }),
      savedTab({ id: "c", group: g2 }),
      savedTab({ id: "d" }),
      savedTab({ id: "e", group: g1 }),
      savedTab({ id: "skip", url: "data:text/html,x", group: g1 }),
      savedTab({ id: "f", group: g1 }),
    ]);
    expect(planSwitch(input({ toTabs })).opening.groups).toEqual([
      { savedTabIds: ["a", "b"], title: "One", color: "red", collapsed: true },
      { savedTabIds: ["c"], title: "Two", color: "blue", collapsed: false },
      { savedTabIds: ["e", "f"], title: "One", color: "red", collapsed: true },
    ]);
  });

  it("creates a blank tab when nothing is restorable (I1)", () => {
    const toTabs = workspaceTabs([savedTab({ id: "bad", url: "devtools://x" })]);
    const plan = planSwitch(input({ toTabs }));
    expect(specs(plan)).toEqual([
      {
        savedTabId: BLANK_SAVED_TAB_ID,
        url: BLANK_TAB_URL,
        mode: "direct",
        index: 1,
        active: true,
      },
    ]);
    expect(plan.op.activeSavedTabId).toBe(BLANK_SAVED_TAB_ID);
    expect(plan.opening.groups).toEqual([]);
    expect(specs(planSwitch(input({ toTabs: workspaceTabs([]) })))).toHaveLength(1);
  });

  it("never yields an empty create list and has exactly one active tab (property)", () => {
    const rand = rng(99);
    const urls = [
      "https://a.com",
      "chrome://x",
      "javascript:x",
      "data:x",
      "file:///a",
      "devtools://x",
    ];
    for (let i = 0; i < 200; i++) {
      const n = Math.floor(rand() * 15);
      const tabs: SavedTab[] = Array.from({ length: n }, (_, j) =>
        savedTab({ id: `t${j}`, url: urls[Math.floor(rand() * urls.length)] as string }),
      );
      const plan = planSwitch(
        input({ toTabs: workspaceTabs(tabs), restoreLimit: Math.floor(rand() * 5) }),
      );
      const s = specs(plan);
      expect(s.length).toBeGreaterThan(0);
      expect(s.filter((x) => x.active)).toHaveLength(1);
      const real = s.filter((x) => x.savedTabId !== BLANK_SAVED_TAB_ID);
      // Every saved tab is either created or reported as skipped; blank only when nothing else.
      expect(real.length + plan.opening.skipped.length).toBe(n);
      expect(s.length === real.length).toBe(real.length > 0);
    }
  });
});

describe("planSwitch — retained tabs", () => {
  const window = liveWindow([
    { id: 1, url: "https://pinned.com", pinned: true },
    { id: 2, url: "https://a.com", active: true },
    { id: 3, url: "chrome-extension://other/page.html" },
    { id: 4, url: "devtools://devtools/inspector.html" },
    { id: 5, url: "chrome://settings" },
    // a placeholder wrapping a restorable URL is outgoing, not retained
    { id: 6, url: buildPlaceholderUrl(BASE, { u: "https://b.com", t: "", w: "wsA", s: "x" }) },
    { id: 7, url: "data:text/html,x" },
  ]);

  it("keeps unrestorable tabs out of outgoingTabIds and reports them as retained", () => {
    const plan = planSwitch(input({ window }));
    expect(plan.op.outgoingTabIds).toEqual([2, 5, 6]);
    expect(plan.retainedTabIds).toEqual([3, 4, 7]);
    // ...and they are not saved either
    expect(plan.outgoingSnapshot?.tabs.map((t) => t.url)).toEqual([
      "https://a.com",
      "chrome://settings",
      "https://b.com",
    ]);
  });

  it("retained and pinned tabs are disjoint from outgoing (property)", () => {
    const rand = rng(5);
    const urls = ["https://a.com", "chrome-extension://x/y", "about:blank", "blob:x", "file:///f"];
    for (let i = 0; i < 100; i++) {
      const tabs = Array.from({ length: Math.floor(rand() * 8) }, (_, j) => ({
        id: j + 1,
        url: urls[Math.floor(rand() * urls.length)] as string,
        pinned: rand() < 0.2,
      }));
      const plan = planSwitch(input({ window: liveWindow(tabs) }));
      const pinned = tabs.filter((t) => t.pinned).map((t) => t.id);
      const all = [...plan.op.outgoingTabIds, ...plan.retainedTabIds, ...pinned].sort(
        (a, b) => a - b,
      );
      expect(all).toEqual(tabs.map((t) => t.id));
      expect(plan.opening.chunks.flat().length).toBeGreaterThan(0);
    }
  });

  it("still creates a blank tab when only retained tabs remain and the target is empty", () => {
    const onlyRetained = liveWindow([{ id: 9, url: "chrome-extension://x/y" }]);
    const plan = planSwitch(input({ window: onlyRetained, from: null, toTabs: workspaceTabs([]) }));
    expect(plan.op.outgoingTabIds).toEqual([]);
    expect(plan.retainedTabIds).toEqual([9]);
    expect(plan.outgoingSnapshot).toBeNull();
    expect(plan.opening.chunks.flat()).toEqual([
      {
        savedTabId: BLANK_SAVED_TAB_ID,
        url: BLANK_TAB_URL,
        mode: "direct",
        index: 0,
        active: true,
      },
    ]);
  });
});

describe("planSwitch — same workspace", () => {
  it("throws PlanError(same_workspace) when from === to", () => {
    expect(() => planSwitch(input({ from: "wsB", to: "wsB" }))).toThrow(PlanError);
    try {
      planSwitch(input({ from: "wsB", to: "wsB" }));
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(PlanError);
      expect((e as PlanError).code).toBe("same_workspace");
      expect((e as PlanError).name).toBe("PlanError");
    }
  });

  it("allows switching an untracked window (from null)", () => {
    expect(() => planSwitch(input({ from: null }))).not.toThrow();
  });
});

describe("planOpening", () => {
  it("honours a custom chunk size and clamps it to >= 1", () => {
    const tabs = [savedTab({ id: "a" }), savedTab({ id: "b", index: 1 })];
    const base = { workspaceId: "w", pinnedCount: 0, restoreLimit: 10, placeholderBase: BASE };
    expect(planOpening(tabs, { ...base, chunkSize: 1 }).chunks).toHaveLength(2);
    expect(planOpening(tabs, { ...base, chunkSize: 0 }).chunks).toHaveLength(2);
  });
});

describe("nextStage", () => {
  it("walks the stages and stays at done", () => {
    expect(nextStage({ stage: "snapshot" })).toBe("opening");
    expect(nextStage({ stage: "opening" })).toBe("activating");
    expect(nextStage({ stage: "activating" })).toBe("closing");
    expect(nextStage({ stage: "closing" })).toBe("done");
    expect(nextStage({ stage: "done" })).toBe("done");
  });
});

describe("canResume", () => {
  const op = (over: Partial<SwitchOp>): SwitchOp => ({
    ...planSwitch(input()).op,
    outgoingTabIds: [2, 3],
    createdTabIds: { b1: 10, b2: 11 },
    ...over,
  });
  const live = (...ids: number[]) => new Set(ids);

  it("abandons when the session epoch changed", () => {
    expect(canResume(op({ stage: "snapshot" }), live(2, 3, 10, 11), "other")).toBe("abandon");
  });

  it("abandons after too many attempts", () => {
    expect(
      canResume(op({ stage: "snapshot", attempts: MAX_SWITCH_ATTEMPTS }), live(), "epoch-1"),
    ).toBe("abandon");
  });

  it("snapshot and done always resume", () => {
    expect(canResume(op({ stage: "snapshot" }), live(), "epoch-1")).toBe("resume");
    expect(canResume(op({ stage: "done" }), live(), "epoch-1")).toBe("resume");
  });

  it.each(["opening", "activating"] as const)("%s needs created and outgoing tabs", (stage) => {
    expect(canResume(op({ stage }), live(2, 3, 10, 11), "epoch-1")).toBe("resume");
    expect(canResume(op({ stage }), live(2, 3, 10), "epoch-1")).toBe("abandon");
    expect(canResume(op({ stage }), live(2, 10, 11), "epoch-1")).toBe("abandon");
  });

  it("closing tolerates already-closed outgoing tabs but not missing created ones", () => {
    expect(canResume(op({ stage: "closing" }), live(10, 11), "epoch-1")).toBe("resume");
    expect(canResume(op({ stage: "closing" }), live(2, 3, 10), "epoch-1")).toBe("abandon");
  });
});
