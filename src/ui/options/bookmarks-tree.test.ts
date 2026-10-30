import { describe, expect, it } from "vitest";
import { LIMITS } from "@/core/model/types";
import {
  type BookmarkNode,
  buildFolderTree,
  collectSelection,
  defaultExpanded,
  destinationOverflow,
  folderState,
  setFolderChecked,
  suggestedWorkspaceName,
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
    expect(suggestedWorkspaceName(tree, new Set())).toBe("Imported");
    expect(suggestedWorkspaceName(tree, new Set(["10"]))).toBe("Work");
    expect(suggestedWorkspaceName(tree, new Set(["1", "10", "2"]))).toBe("Bookmarks bar");
  });
});

describe("destinationOverflow", () => {
  it("quick links count existing items against the total cap", () => {
    expect(destinationOverflow("quicklinks", 30, 0)).toBe(0);
    expect(destinationOverflow("quicklinks", 30, 90)).toBe(20);
    expect(destinationOverflow("quicklinks", 30, 500)).toBe(30);
  });

  it("one workspace is capped per workspace; per-folder is not summed", () => {
    expect(destinationOverflow("workspace", LIMITS.linksPerWorkspace + 3, 0)).toBe(3);
    expect(destinationOverflow("workspacePerFolder", 5000, 0)).toBe(0);
  });
});
