import { describe, expect, it } from "vitest";
import { LIMITS } from "@/core/model/types";
import {
  type BookmarkNode,
  buildFolderTree,
  collectSelection,
  defaultExpanded,
  folderState,
  folderStates,
  importCalls,
  normalizeEntries,
  previewImport,
  setFolderChecked,
  suggestedWorkspaceName,
  sumWarnings,
  topSelected,
} from "./bookmarks-tree";

const link = (id: string, url: string, title = id): BookmarkNode => ({ id, title, url });
const folder = (id: string, title: string, children: BookmarkNode[]): BookmarkNode => ({
  id,
  title,
  children,
});

const ROOT: BookmarkNode[] = [
  folder("0", "", [
    folder("1", "Bookmarks bar", [
      link("a", "https://a.example/"),
      link("js", "javascript:alert(1)"),
      folder("10", "Work", [
        link("b", "https://b.example/"),
        link("c", "file:///tmp/c.html"),
        folder("100", "Deep", [link("d", "ftp://d.example/")]),
      ]),
      folder("11", "Empty", []),
    ]),
    folder("2", "Other bookmarks", [link("e", "http://e.example/"), link("x", "edge://settings")]),
    folder("3", "Mobile bookmarks", []),
  ]),
];

describe("buildFolderTree", () => {
  const tree = buildFolderTree(ROOT);

  it("drops the synthetic root and empty folders", () => {
    expect(tree.map((f) => f.title)).toEqual(["Bookmarks bar", "Other bookmarks"]);
    expect(tree[0]?.children.map((f) => f.title)).toEqual(["Work"]);
  });

  it("counts importable and unsupported links recursively", () => {
    const bar = tree[0];
    expect(bar?.links.map((l) => l.url)).toEqual(["https://a.example/"]);
    expect(bar?.unsupported).toBe(1);
    expect(bar?.totalLinks).toBe(4);
    expect(bar?.totalUnsupported).toBe(1);
    expect(tree[1]?.totalLinks).toBe(1);
    expect(tree[1]?.totalUnsupported).toBe(1);
  });

  it("builds paths from the top-level folder", () => {
    expect(tree[0]?.children[0]?.children[0]?.path).toEqual(["Bookmarks bar", "Work", "Deep"]);
  });

  it("accepts a non-synthetic root array", () => {
    const t = buildFolderTree([folder("9", "Solo", [link("z", "https://z.example/")])]);
    expect(t.map((f) => f.title)).toEqual(["Solo"]);
  });

  it("expands the top level by default", () => {
    expect([...defaultExpanded(tree)]).toEqual(["1", "2"]);
  });
});

describe("selection", () => {
  const tree = buildFolderTree(ROOT);

  it("checking a parent checks its subtree; unchecking clears it", () => {
    const all = setFolderChecked(tree, new Set(), "1", true);
    expect([...all].sort()).toEqual(["1", "10", "100"]);
    const none = setFolderChecked(tree, all, "10", false);
    expect([...none]).toEqual(["1"]);
  });

  it("derives all / some / none", () => {
    const bar = tree[0];
    if (!bar) throw new Error("tree");
    expect(folderState(bar, new Set())).toBe("none");
    expect(folderState(bar, new Set(["1"]))).toBe("some");
    expect(folderState(bar, new Set(["1", "10", "100"]))).toBe("all");
    expect(folderState(bar, new Set(["100"]))).toBe("some");
  });

  it("collects the links directly inside selected folders only", () => {
    const c = collectSelection(tree, new Set(["10"]));
    expect(c.folders).toBe(1);
    expect(c.links).toBe(2);
    expect(c.unsupported).toBe(0);
    expect(c.entries).toEqual([
      { path: ["Bookmarks bar", "Work"], title: "b", url: "https://b.example/" },
      { path: ["Bookmarks bar", "Work"], title: "c", url: "file:///tmp/c.html" },
    ]);
  });

  it("counts unsupported links of selected folders and totals a whole subtree", () => {
    const c = collectSelection(tree, setFolderChecked(tree, new Set(), "1", true));
    expect(c.folders).toBe(3);
    expect(c.links).toBe(4);
    expect(c.unsupported).toBe(1);
    expect(c.capped).toBe(0);
  });

  it("uses the URL when a link has no title", () => {
    const t = buildFolderTree([folder("9", "F", [link("z", "https://z.example/", "  ")])]);
    expect(collectSelection(t, new Set(["9"])).entries[0]?.title).toBe("https://z.example/");
  });

  it("caps the entries at LIMITS.importEntries and reports the rest", () => {
    const many = Array.from({ length: LIMITS.importEntries + 5 }, (_, i) =>
      link(`l${i}`, `https://e.example/${i}`),
    );
    const c = collectSelection(buildFolderTree([folder("9", "Big", many)]), new Set(["9"]));
    expect(c.entries).toHaveLength(LIMITS.importEntries);
    expect(c.links).toBe(LIMITS.importEntries + 5);
    expect(c.capped).toBe(5);
  });

  it("names the one-workspace prefill after the first topmost selected folder", () => {
    expect(suggestedWorkspaceName(tree, new Set(), "Imported")).toBe("Imported");
    expect(suggestedWorkspaceName(tree, new Set(["10"]), "Imported")).toBe("Work");
    expect(suggestedWorkspaceName(tree, new Set(["1", "10", "2"]), "Imported")).toBe(
      "Bookmarks bar",
    );
  });
});

describe("folderStates", () => {
  it("computes every folder's state in one pass", () => {
    const tree = buildFolderTree(ROOT);
    const m = folderStates(tree, new Set(["10", "100"]));
    expect(Object.fromEntries(m)).toEqual({ "1": "some", "10": "all", "100": "all", "2": "none" });
  });
});

describe("normalizeEntries", () => {
  it("cuts names, titles and depth to the RPC limits and counts shortened paths", () => {
    const deep = Array.from({ length: 40 }, (_, i) => `f${i}`);
    const out = normalizeEntries([
      { path: ["ok"], title: "t", url: "https://a.example/" },
      { path: ["x".repeat(250)], title: "y".repeat(2500), url: "https://b.example/" },
      { path: deep, title: "d", url: "https://c.example/" },
    ]);
    expect(out.shortened).toBe(2);
    expect(out.entries[0]).toEqual({ path: ["ok"], title: "t", url: "https://a.example/" });
    expect(out.entries[1]?.path[0]).toHaveLength(200);
    expect(out.entries[1]?.title).toHaveLength(2000);
    expect(out.entries[2]?.path).toEqual(deep.slice(0, 32));
  });
});

describe("importCalls", () => {
  const tree = buildFolderTree(ROOT);
  const opts = { name: "Mine", color: "blue" as const, fallbackName: "Imported" };

  it("quick links and one workspace send one call with every selected link", () => {
    const sel = setFolderChecked(tree, new Set(), "1", true);
    const q = importCalls(tree, sel, { ...opts, dest: "quicklinks" });
    expect(q.calls).toHaveLength(1);
    expect(q.calls[0]?.target).toEqual({ kind: "quicklinks" });
    expect(q.calls[0]?.entries).toHaveLength(4);
    const w = importCalls(tree, sel, { ...opts, dest: "workspace" });
    expect(w.calls[0]?.target).toEqual({ kind: "workspace", name: "Mine", color: "blue" });
  });

  it("per folder with one topmost folder: one call rooted at it", () => {
    const sel = setFolderChecked(tree, new Set(), "1", true);
    expect(topSelected(tree, sel).map((f) => f.id)).toEqual(["1"]);
    const r = importCalls(tree, sel, { ...opts, dest: "workspacePerFolder" });
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0]?.target).toEqual({
      kind: "workspacePerFolder",
      color: "blue",
      root: ["Bookmarks bar"],
    });
  });

  it("per folder with several topmost folders: one workspace per folder", () => {
    const sel = new Set(["10", "100", "2"]);
    const r = importCalls(tree, sel, { ...opts, dest: "workspacePerFolder" });
    expect(r.calls.map((c) => c.target)).toEqual([
      { kind: "workspace", name: "Work", color: "blue" },
      { kind: "workspace", name: "Other bookmarks", color: "blue" },
    ]);
    expect(r.calls[0]?.entries.map((e) => e.url)).toEqual([
      "https://b.example/",
      "file:///tmp/c.html",
      "ftp://d.example/",
    ]);
    expect(r.calls[1]?.entries.map((e) => e.url)).toEqual(["http://e.example/"]);
  });

  it("nothing selected: no calls", () => {
    expect(importCalls(tree, new Set(), { ...opts, dest: "quicklinks" }).calls).toEqual([]);
  });
});

describe("previewImport", () => {
  const tree = buildFolderTree(ROOT);

  it("runs the planner against the current quick links (dedupe and room)", () => {
    const sel = setFolderChecked(tree, new Set(), "1", true);
    const { calls } = importCalls(tree, sel, {
      dest: "quicklinks",
      name: "",
      color: "blue",
      fallbackName: "Imported",
    });
    const existing = [
      "https://a.example/",
      ...Array.from({ length: LIMITS.quickLinks - 2 }, (_, i) => `https://q.example/${i}`),
    ];
    const p = previewImport(calls, 4, existing);
    expect(p.added).toBe(1);
    expect(p.skipped).toBe(3);
    expect(p.counts).toEqual({ duplicates: 1, quicklinks_limit: 2 });
  });

  it("sums several calls", () => {
    const { calls } = importCalls(tree, new Set(["10", "100", "2"]), {
      dest: "workspacePerFolder",
      name: "",
      color: "blue",
      fallbackName: "Imported",
    });
    expect(previewImport(calls, 4, [])).toEqual({ added: 4, skipped: 0, counts: {} });
  });
});

describe("sumWarnings", () => {
  it("sums known codes and keeps unknown ones raw", () => {
    expect(
      sumWarnings([
        ["duplicates:2", "odd"],
        ["duplicates:1", "links_limit:4"],
      ]),
    ).toEqual({
      counts: { duplicates: 3, links_limit: 4 },
      other: ["odd"],
    });
  });
});
