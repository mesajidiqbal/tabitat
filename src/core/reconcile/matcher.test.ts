import { describe, expect, it } from "vitest";
import { buildPlaceholderUrl } from "../ops/url";
import { BASE, liveWindow, savedTab, workspaceMeta, workspaceTabs } from "../testing/fixtures";
import { countUnmatchedSessionWindows, jaccard, matchWindows } from "./matcher";

const ws = (id: string, urls: string[]) => ({
  meta: workspaceMeta(id),
  tabs: workspaceTabs(urls.map((url, i) => savedTab({ id: `${id}-${i}`, url }))),
});
const ph = (w: string, u = "https://x.com/") => buildPlaceholderUrl(BASE, { u, t: "", w, s: "s" });
const opts = { placeholderBase: BASE };

describe("jaccard", () => {
  it("computes |A∩B|/|A∪B|", () => {
    expect(jaccard(new Set(["a", "b"]), new Set(["b", "c"]))).toBeCloseTo(1 / 3);
    expect(jaccard(new Set(), new Set())).toBe(0);
    expect(jaccard(new Set(["a"]), new Set(["a"]))).toBe(1);
  });
});

describe("matchWindows", () => {
  const A = ws("A", ["https://a1.com", "https://a2.com", "https://a3.com"]);
  const B = ws("B", ["https://b1.com", "https://b2.com"]);

  it("prefers a majority placeholder hint", () => {
    const win = liveWindow([{ url: ph("B") }, { url: ph("B") }, { url: "https://a1.com" }], [], 7);
    expect(matchWindows([win], [A, B], opts)).toEqual([
      { windowId: 7, workspaceId: "B", reason: "hint" },
    ]);
  });

  it("a hint needs a majority of all non-pinned, non-blank tabs (one stale placeholder loses)", () => {
    const stale = liveWindow(
      [
        { url: ph("B") },
        { url: "https://u1.com" },
        { url: "https://u2.com" },
        { url: "about:blank" },
        { url: "https://p.com", pinned: true },
      ],
      [],
      3,
    );
    expect(matchWindows([stale], [A, B], opts)[0]?.reason).toBe("none");
    // tie (1 of 2 counted tabs) -> similarity decides, not the hint
    const tie = liveWindow([{ url: ph("B", "https://a1.com") }, { url: "https://a2.com" }], [], 4);
    const res = matchWindows([tie], [A, B], opts)[0];
    expect(res?.reason).not.toBe("hint");
    // blank tabs do not count against the hint
    const blanks = liveWindow([{ url: ph("B") }, { url: "about:blank" }, { url: "" }], [], 5);
    expect(matchWindows([blanks], [A, B], opts)[0]).toEqual({
      windowId: 5,
      workspaceId: "B",
      reason: "hint",
    });
  });

  it("ignores hints without a majority or for unknown workspaces", () => {
    const split = liveWindow(
      [{ url: ph("A") }, { url: ph("B") }, { url: ph("ghost") }, { url: ph("ghost") }],
      [],
      1,
    );
    expect(matchWindows([split], [A, B], opts)[0]).toEqual({
      windowId: 1,
      workspaceId: null,
      reason: "none",
    });
  });

  it("falls back to Jaccard similarity >= 0.6 over unwrapped, normalized URLs", () => {
    const win = liveWindow(
      [
        { url: "https://a1.com/#x" },
        { url: ph("zzz", "https://a2.com/") },
        { url: "https://a3.com" },
        { url: "https://other.com" },
        { url: "https://pinned.com", pinned: true },
        { url: "chrome-extension://x/y" },
      ],
      [],
      2,
    );
    // 3 shared of 4 in the union = 0.75
    expect(matchWindows([win], [B, A], opts)).toEqual([
      { windowId: 2, workspaceId: "A", reason: "similarity" },
    ]);
  });

  it("only counts internal schemes the browser can open", () => {
    const E = ws("E", ["edge://a", "edge://b", "https://e.com"]);
    const win = liveWindow(
      [{ url: "edge://a" }, { url: "edge://b" }, { url: "https://e.com" }],
      [],
      8,
    );
    // Chrome default: the edge:// tabs are ignored in the window set -> 1/3 < 0.6
    expect(matchWindows([win], [E], opts)[0]?.reason).toBe("none");
    expect(
      matchWindows([win], [E], { ...opts, directSchemes: ["edge:", "about:"] })[0]?.reason,
    ).toBe("similarity");
  });

  it("ignores blank / new-tab pages in the window's URL set", () => {
    const win = liveWindow(
      [
        { url: "https://b1.com" },
        { url: "https://b2.com" },
        { url: "chrome://newtab/" },
        { url: "about:blank" },
      ],
      [],
      9,
    );
    expect(matchWindows([win], [B], opts)[0]).toEqual({
      windowId: 9,
      workspaceId: "B",
      reason: "similarity",
    });
  });

  it("returns none below the threshold", () => {
    const win = liveWindow([{ url: "https://a1.com" }, { url: "https://zz.com" }], [], 3);
    expect(matchWindows([win], [A], opts)[0]?.reason).toBe("none");
  });

  it("ignores windows with no tabs; pinned-only windows match nothing", () => {
    const empty = liveWindow([], [], 4);
    const pinned = liveWindow([{ url: "https://a1.com", pinned: true }], [], 5);
    expect(matchWindows([empty, pinned], [A], opts)).toEqual([
      { windowId: 5, workspaceId: null, reason: "none" },
    ]);
  });

  it("gives a workspace to one window only: best score wins, loser gets conflict", () => {
    const exact = liveWindow(
      [{ url: "https://a1.com" }, { url: "https://a2.com" }, { url: "https://a3.com" }],
      [],
      10,
    );
    const close = liveWindow(
      [
        { url: "https://a1.com" },
        { url: "https://a2.com" },
        { url: "https://a3.com" },
        { url: "https://q.com" },
      ],
      [],
      11,
    );
    const hinted = liveWindow([{ url: ph("A") }], [], 12);
    expect(matchWindows([close, exact], [A], opts)).toEqual([
      { windowId: 11, workspaceId: null, reason: "conflict" },
      { windowId: 10, workspaceId: "A", reason: "similarity" },
    ]);
    // a hint outranks perfect similarity
    expect(matchWindows([exact, hinted], [A], opts)).toEqual([
      { windowId: 10, workspaceId: null, reason: "conflict" },
      { windowId: 12, workspaceId: "A", reason: "hint" },
    ]);
    // ties keep the earlier window
    const twin = { ...exact, id: 13 };
    expect(matchWindows([exact, twin], [A], opts).map((m) => m.reason)).toEqual([
      "similarity",
      "conflict",
    ]);
  });
});

describe("countUnmatchedSessionWindows", () => {
  const sw = (windowId: number, workspaceId: string | null, urls: string[]) => ({
    windowId,
    workspaceId,
    tabs: urls.map((url, i) => savedTab({ id: `${windowId}-${i}`, url })),
  });
  const gen = (...windows: ReturnType<typeof sw>[]) => ({ id: 3, takenAt: 1, windows });

  it("counts windows neither owned by a live window nor similar to one", () => {
    const g = gen(
      sw(1, "A", ["https://a1.com", "https://a2.com"]),
      sw(2, null, ["https://b1.com", "https://b2.com"]),
      sw(3, "C", ["https://c1.com"]),
      sw(4, null, ["chrome://newtab/", "about:blank"]),
      sw(0, "D", ["https://d1.com"]),
    );
    const live = [
      liveWindow([{ url: ph("B", "https://b1.com") }, { url: "https://b2.com/" }], [], 9),
    ];
    // A is owned; window 2 matches by URLs (placeholder unwrapped); 3 is lost; blank and
    // storage-only (windowId 0) windows are ignored.
    expect(countUnmatchedSessionWindows(g, live, new Set(["A"]), opts)).toBe(1);
    expect(countUnmatchedSessionWindows(g, [], new Set(), opts)).toBe(3);
  });

  it("is one-to-one: one survivor satisfies only one of two identical generation windows", () => {
    const urls = ["https://x1.com", "https://x2.com"];
    const g = gen(sw(1, null, urls), sw(2, null, urls));
    const one = [liveWindow([{ url: "https://x1.com/" }, { url: "https://x2.com/" }], [], 9)];
    expect(countUnmatchedSessionWindows(g, one, new Set(), opts)).toBe(1);
    const two = [...one, { ...(one[0] as (typeof one)[number]), id: 10 }];
    expect(countUnmatchedSessionWindows(g, two, new Set(), opts)).toBe(0);
  });

  it("assigns by best similarity first, and an owned workspace counts once", () => {
    // live 9 is exact for gen window 2 and only 2/3 similar to gen window 1
    const g = gen(
      sw(1, null, ["https://p1.com", "https://p2.com", "https://p3.com"]),
      sw(2, null, ["https://p1.com", "https://p2.com"]),
    );
    const live = [liveWindow([{ url: "https://p1.com/" }, { url: "https://p2.com/" }], [], 9)];
    expect(countUnmatchedSessionWindows(g, live, new Set(), opts)).toBe(1);
    // two generation windows of workspace A, one owner
    const owned = gen(sw(1, "A", ["https://a.com"]), sw(2, "A", ["https://b.com"]));
    expect(countUnmatchedSessionWindows(owned, [], new Set(["A"]), opts)).toBe(1);
  });

  it("with an owner map, the owning live window is consumed by the ownership match", () => {
    const urls = ["https://x1.com", "https://x2.com"];
    const g = gen(sw(1, "A", urls), sw(2, null, urls));
    const live = [liveWindow([{ url: "https://x1.com/" }, { url: "https://x2.com/" }], [], 9)];
    expect(countUnmatchedSessionWindows(g, live, new Set(["A"]), opts)).toBe(0);
    expect(countUnmatchedSessionWindows(g, live, new Map([["A", 9]]), opts)).toBe(1);
  });
});
