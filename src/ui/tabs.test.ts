import { describe, expect, it } from "vitest";
import { buildPlaceholderUrl } from "@/core/ops/url";
import { buildTabNodes, duplicateCount, mapTab, type TabNode, tabRuns, type UiTab } from "./tabs";

const BASE = "chrome-extension://abc/suspended.html";

const chromeTab = (over: Partial<chrome.tabs.Tab>): chrome.tabs.Tab =>
  ({
    id: 1,
    windowId: 1,
    index: 0,
    url: "https://example.com/",
    title: "Example",
    pinned: false,
    active: false,
    highlighted: false,
    incognito: false,
    discarded: false,
    autoDiscardable: true,
    groupId: -1,
    frozen: false,
    selected: false,
    ...over,
  }) as chrome.tabs.Tab;

describe("ui tabs", () => {
  it("unwraps placeholder tabs for display and marks them suspended", () => {
    const url = buildPlaceholderUrl(BASE, {
      u: "https://a.example/x",
      t: "A page",
      w: "ws",
      s: "s1",
    });
    const tab = mapTab(chromeTab({ url, title: "" }), BASE);
    expect(tab).toMatchObject({
      url: "https://a.example/x",
      rawUrl: url,
      title: "A page",
      placeholder: true,
    });
    expect(mapTab(chromeTab({}), BASE).placeholder).toBe(false);
  });

  it("prefers the pending URL while loading", () => {
    const tab = mapTab(
      chromeTab({ url: "", pendingUrl: "https://b.example/", status: "loading" }),
      BASE,
    );
    expect(tab.url).toBe("https://b.example/");
  });

  it("groups consecutive tabs into runs by tab group", () => {
    const t = (id: number, groupId: number) =>
      ({ ...mapTab(chromeTab({ id, index: id }), BASE), groupId }) as UiTab;
    const runs = tabRuns([t(1, -1), t(2, -1), t(3, 7), t(4, 7), t(5, -1)], {
      7: { id: 7, title: "Docs", color: "purple", collapsed: false },
    });
    expect(runs.map((r) => [r.group?.title ?? null, r.tabs.map((x) => x.id)])).toEqual([
      [null, [1, 2]],
      ["Docs", [3, 4]],
      [null, [5]],
    ]);
  });

  it("builds the roving node list: headers first, collapsed groups hide their tabs", () => {
    const t = (id: number, groupId: number) =>
      ({ ...mapTab(chromeTab({ id, index: id }), BASE), groupId }) as UiTab;
    const groups = {
      7: { id: 7, title: "Docs", color: "purple", collapsed: false },
      8: { id: 8, title: "Ops", color: "red", collapsed: false },
    } as const;
    const runs = tabRuns([t(1, -1), t(2, 7), t(3, 7), t(4, 8), t(5, -1)], groups);
    const label = (n: TabNode) => (n.kind === "header" ? `g${n.groupId}` : `t${n.tab.id}`);
    expect(buildTabNodes(runs, {}).map(label)).toEqual(["t1", "g7", "t2", "t3", "g8", "t4", "t5"]);
    expect(buildTabNodes(runs, { 7: true }).map(label)).toEqual(["t1", "g7", "g8", "t4", "t5"]);
    expect(buildTabNodes(runs, { 7: true, 8: true }).map(label)).toEqual(["t1", "g7", "g8", "t5"]);
    expect(buildTabNodes([], {})).toEqual([]);
  });

  it("treats a run whose group is unknown as plain tabs (no header)", () => {
    const tab = { ...mapTab(chromeTab({ id: 9 }), BASE), groupId: 42 } as UiTab;
    const runs = tabRuns([tab], {});
    expect(buildTabNodes(runs, { 42: true }).map((n) => n.kind)).toEqual(["tab"]);
  });

  it("counts duplicates like the worker (placeholders unwrapped, pinned ignored)", () => {
    const ph = buildPlaceholderUrl(BASE, { u: "https://dup.example/", t: "", w: "", s: "" });
    const tabs = [
      chromeTab({ id: 1, url: "https://dup.example/" }),
      chromeTab({ id: 2, url: ph }),
      chromeTab({ id: 3, url: "https://dup.example/#frag" }),
      chromeTab({ id: 4, url: "https://dup.example/", pinned: true }),
      chromeTab({ id: 5, url: "https://other.example/" }),
    ].map((x) => mapTab(x, BASE));
    expect(duplicateCount(tabs, BASE)).toBe(2);
  });
});
