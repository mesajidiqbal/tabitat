import { describe, expect, it } from "vitest";
import {
  BASE,
  liveGroup,
  liveTab,
  liveWindow,
  NOW,
  rng,
  savedTab,
  seqIds,
  shuffle,
  workspaceTabs,
} from "../testing/fixtures";
import { snapshotWindow, tabsEqual } from "./snapshot";
import { buildPlaceholderUrl } from "./url";

const opts = () => ({ placeholderBase: BASE, now: NOW, newId: seqIds("new") });

describe("snapshotWindow", () => {
  it("saves non-pinned restorable tabs with sequential indices and new ids", () => {
    const win = liveWindow([
      { url: "https://pinned.com", pinned: true },
      { url: "https://a.com", title: "A", favIconUrl: "https://a.com/f.ico", active: true },
      { url: "chrome-extension://other/x.html" },
      { url: "chrome://settings", title: "Settings" },
      { url: "javascript:void(0)" },
    ]);
    const snap = snapshotWindow(win, null, opts());
    expect(snap).toEqual({
      tabs: [
        {
          id: "new-1",
          url: "https://a.com",
          title: "A",
          index: 0,
          favIconUrl: "https://a.com/f.ico",
        },
        { id: "new-2", url: "chrome://settings", title: "Settings", index: 1 },
      ],
      activeSavedTabId: "new-1",
      updatedAt: NOW,
      rev: 1,
    });
  });

  it("orders by live index, not array order", () => {
    const win = liveWindow([]);
    win.tabs = [
      liveTab({ url: "https://b.com", index: 1, id: 2 }),
      liveTab({ url: "https://a.com", index: 0, id: 1 }),
    ];
    expect(snapshotWindow(win, null, opts()).tabs.map((t) => t.url)).toEqual([
      "https://a.com",
      "https://b.com",
    ]);
  });

  it("unwraps placeholders and keeps their saved id, title and previous favicon", () => {
    const prev = workspaceTabs([
      savedTab({ id: "s1", url: "https://a.com/x", title: "Old", favIconUrl: "https://a.com/i" }),
    ]);
    const ph = buildPlaceholderUrl(BASE, { u: "https://a.com/x", t: "A title", w: "w", s: "s1" });
    const win = liveWindow([{ url: ph, title: "ignored", favIconUrl: `${BASE}/icon.png` }]);
    const snap = snapshotWindow(win, prev, opts());
    expect(snap.tabs).toEqual([
      {
        id: "s1",
        url: "https://a.com/x",
        title: "A title",
        index: 0,
        favIconUrl: "https://a.com/i",
      },
    ]);
  });

  it("falls back to the live title when the placeholder has no t", () => {
    const ph = `${BASE}#u=${encodeURIComponent("https://a.com/")}`;
    const snap = snapshotWindow(liveWindow([{ url: ph, title: "Live" }]), null, opts());
    expect(snap.tabs[0]).toMatchObject({ url: "https://a.com/", title: "Live" });
    expect(snap.tabs[0]).not.toHaveProperty("favIconUrl");
  });

  it("matches ids by placeholder s, then exact url, then normalized url", () => {
    const prev = workspaceTabs([
      savedTab({ id: "p1", url: "https://dup.com/" }),
      savedTab({ id: "p2", url: "https://dup.com/" }),
      savedTab({ id: "p3", url: "https://norm.com/page/" }),
      savedTab({ id: "p4", url: "https://gone.com" }),
    ]);
    const ph = buildPlaceholderUrl(BASE, { u: "https://dup.com/", t: "", w: "w", s: "p2" });
    const win = liveWindow([
      { url: "https://dup.com/" }, // exact -> p1 (p2 is claimed by the placeholder)
      { url: ph }, // s -> p2
      { url: "https://norm.com/page#section" }, // normalized -> p3
      { url: "https://dup.com/" }, // nothing left -> new
    ]);
    const snap = snapshotWindow(win, prev, opts());
    expect(snap.tabs.map((t) => t.id)).toEqual(["p1", "p2", "p3", "new-1"]);
  });

  it("ignores a placeholder s that is unknown or already used", () => {
    const prev = workspaceTabs([savedTab({ id: "p1", url: "https://a.com" })]);
    const ph1 = buildPlaceholderUrl(BASE, { u: "https://a.com", t: "", w: "w", s: "p1" });
    const ph2 = buildPlaceholderUrl(BASE, { u: "https://b.com", t: "", w: "w", s: "p1" });
    const ph3 = buildPlaceholderUrl(BASE, { u: "https://c.com", t: "", w: "w", s: "zzz" });
    const snap = snapshotWindow(
      liveWindow([{ url: ph1 }, { url: ph2 }, { url: ph3 }]),
      prev,
      opts(),
    );
    expect(snap.tabs.map((t) => t.id)).toEqual(["p1", "new-1", "new-2"]);
  });

  it("keeps ids stable across random reorders (property)", () => {
    const rand = rng(1);
    const urls = Array.from({ length: 12 }, (_, i) => `https://site${i}.com/p`);
    const first = snapshotWindow(liveWindow(urls.map((url) => ({ url }))), null, opts());
    const idByUrl = new Map(first.tabs.map((t) => [t.url, t.id]));
    let prev = first;
    for (let i = 0; i < 50; i++) {
      const order = shuffle(urls, rand);
      const next = snapshotWindow(liveWindow(order.map((url) => ({ url }))), prev, opts());
      for (const t of next.tabs) expect(t.id).toBe(idByUrl.get(t.url));
      expect(new Set(next.tabs.map((t) => t.id)).size).toBe(urls.length);
      prev = next;
    }
  });

  it("maps groups with stable ids by title+color", () => {
    const win1 = liveWindow(
      [
        { url: "https://a.com", groupId: 5 },
        { url: "https://b.com", groupId: 5 },
        { url: "https://c.com", groupId: 6 },
        { url: "https://d.com", groupId: 99 }, // unknown group -> ungrouped
      ],
      [liveGroup(5, "Work", "red"), { ...liveGroup(6, "Play", "green"), collapsed: true }],
    );
    const s1 = snapshotWindow(win1, null, opts());
    const g1 = s1.tabs[0]?.group;
    expect(g1).toMatchObject({ title: "Work", color: "red", collapsed: false });
    expect(s1.tabs[1]?.group).toEqual(g1);
    expect(s1.tabs[2]?.group).toMatchObject({ title: "Play", color: "green", collapsed: true });
    expect(s1.tabs[3]).not.toHaveProperty("group");

    // After a restart chrome group ids change; ours stay.
    const win2 = liveWindow(
      [
        { url: "https://a.com", groupId: 50 },
        { url: "https://c.com", groupId: 60 },
        { url: "https://e.com", groupId: 70 },
      ],
      [liveGroup(50, "Work", "red"), liveGroup(60, "Play", "blue"), liveGroup(70, "Work", "red")],
    );
    const s2 = snapshotWindow(win2, s1, opts());
    expect(s2.tabs[0]?.group?.id).toBe(g1?.id);
    expect(s2.tabs[1]?.group?.id).not.toBe(s1.tabs[2]?.group?.id); // colour changed -> new id
    expect(s2.tabs[2]?.group?.id).not.toBe(g1?.id); // second "Work" group cannot reuse
  });

  it("returns prev itself when nothing changed", () => {
    const win = liveWindow(
      [
        { url: "https://a.com", title: "A", active: true, groupId: 1 },
        { url: "https://b.com", title: "B" },
      ],
      [liveGroup(1, "G")],
    );
    const s1 = snapshotWindow(win, null, opts());
    const s2 = snapshotWindow(win, s1, { ...opts(), now: NOW + 5000 });
    expect(s2).toBe(s1);
  });

  it("bumps rev and updatedAt on change (title, active tab, order)", () => {
    const win = liveWindow([
      { url: "https://a.com", title: "A", active: true },
      { url: "https://b.com", title: "B" },
    ]);
    const s1 = snapshotWindow(win, null, opts());
    const titled = liveWindow([
      { url: "https://a.com", title: "A2", active: true },
      { url: "https://b.com", title: "B" },
    ]);
    const s2 = snapshotWindow(titled, s1, { ...opts(), now: NOW + 1 });
    expect(s2).not.toBe(s1);
    expect(s2.rev).toBe(2);
    expect(s2.updatedAt).toBe(NOW + 1);
    expect(s2.tabs.map((t) => t.id)).toEqual(s1.tabs.map((t) => t.id));

    const activeMoved = liveWindow([
      { url: "https://a.com", title: "A2" },
      { url: "https://b.com", title: "B", active: true },
    ]);
    const s3 = snapshotWindow(activeMoved, s2, opts());
    expect(s3.rev).toBe(3);
    expect(s3.activeSavedTabId).toBe(s1.tabs[1]?.id);
  });

  it("omits activeSavedTabId when the active tab is pinned or skipped", () => {
    const snap = snapshotWindow(
      liveWindow([{ url: "https://p.com", pinned: true, active: true }, { url: "https://a.com" }]),
      null,
      opts(),
    );
    expect(snap).not.toHaveProperty("activeSavedTabId");
  });

  it("handles an empty window", () => {
    expect(snapshotWindow(liveWindow([]), null, opts())).toEqual({
      tabs: [],
      updatedAt: NOW,
      rev: 1,
    });
  });
});

describe("tabsEqual", () => {
  const g = { id: "g", title: "G", color: "red" as const, collapsed: false };
  const a = savedTab({ id: "a", group: g });
  it("compares every field", () => {
    expect(tabsEqual([a], [{ ...a }])).toBe(true);
    expect(tabsEqual([a], [])).toBe(false);
    expect(tabsEqual([a], [{ ...a, title: "x" }])).toBe(false);
    expect(tabsEqual([a], [{ ...a, url: "https://x.com" }])).toBe(false);
    expect(tabsEqual([a], [{ ...a, index: 3 }])).toBe(false);
    expect(tabsEqual([a], [{ ...a, favIconUrl: "x" }])).toBe(false);
    expect(tabsEqual([a], [{ ...a, group: undefined }])).toBe(false);
    expect(tabsEqual([a], [{ ...a, group: { ...g, collapsed: true } }])).toBe(false);
    expect(tabsEqual([{ ...a, group: undefined }], [{ ...a, group: undefined }])).toBe(true);
  });
});
