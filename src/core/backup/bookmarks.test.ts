import { describe, expect, it } from "vitest";
import { LIMITS } from "../model/types";
import {
  type BookmarkInput,
  commonRoot,
  importName,
  isImportableUrl,
  planBookmarkImport,
} from "./bookmarks";

const bm = (path: string[], url: string, title = url): BookmarkInput => ({ path, title, url });
const none = { quickLinkUrls: [] };

describe("bookmark import helpers", () => {
  it("importName trims, caps at 200 and defaults to Imported", () => {
    expect(importName("  Work  ")).toBe("Work");
    expect(importName("   ")).toBe("Imported");
    expect(importName(undefined)).toBe("Imported");
    expect(importName("x".repeat(300))).toHaveLength(200);
  });

  it("isImportableUrl accepts placeholder/direct schemes only", () => {
    expect(isImportableUrl("https://a.example/")).toBe(true);
    expect(isImportableUrl("file:///tmp/a")).toBe(true);
    expect(isImportableUrl("chrome://settings/")).toBe(true);
    expect(isImportableUrl("edge://settings/")).toBe(false);
    expect(isImportableUrl("javascript:alert(1)")).toBe(false);
    expect(isImportableUrl(" JavaScript:alert(1)")).toBe(false);
    expect(isImportableUrl("data:text/html,x")).toBe(false);
    expect(isImportableUrl("not a url")).toBe(false);
  });

  it("commonRoot is the longest shared folder prefix", () => {
    expect(commonRoot([])).toEqual([]);
    expect(
      commonRoot([bm(["Bar", "Work", "A"], "https://a/"), bm(["Bar", "Work"], "https://b/")]),
    ).toEqual(["Bar", "Work"]);
    expect(commonRoot([bm(["Bar"], "https://a/"), bm(["Other"], "https://b/")])).toEqual([]);
  });
});

describe("planBookmarkImport", () => {
  it("quick links: skips unsupported, dedupes within the import and against existing", () => {
    const plan = planBookmarkImport(
      [
        bm(["Bar"], "https://a.example/", " A "),
        bm(["Bar"], "https://a.example/#frag"),
        bm(["Bar"], "https://b.example"),
        bm(["Bar"], "edge://flags/"),
        bm(["Bar"], "https://c.example/"),
      ],
      { kind: "quicklinks" },
      { quickLinkUrls: ["https://b.example/"] },
    );
    expect(plan.quickLinks).toEqual([
      { url: "https://a.example/", title: "A" },
      { url: "https://c.example/", title: "https://c.example/" },
    ]);
    expect(plan).toMatchObject({ added: 2, skipped: 3, workspaces: [] });
    expect(plan.warnings).toEqual(["unsupported:1", "duplicates:2"]);
  });

  it("quick links: the total is capped at LIMITS.quickLinks", () => {
    const existing = Array.from({ length: LIMITS.quickLinks - 2 }, (_, i) => `https://e/${i}`);
    const entries = Array.from({ length: 5 }, (_, i) => bm(["Bar"], `https://n.example/${i}`));
    const plan = planBookmarkImport(entries, { kind: "quicklinks" }, { quickLinkUrls: existing });
    expect(plan.quickLinks).toHaveLength(2);
    expect(plan).toMatchObject({ added: 2, skipped: 3, warnings: ["quicklinks_limit:3"] });
  });

  it("one workspace: named (trimmed / Imported), deduped, capped at linksPerWorkspace", () => {
    const entries = Array.from({ length: LIMITS.linksPerWorkspace + 3 }, (_, i) =>
      bm(["Bar", `F${i % 3}`], `https://w.example/${i}`),
    );
    entries.push(bm(["Bar"], "https://w.example/0/"));
    const plan = planBookmarkImport(entries, { kind: "workspace", name: "  Work " }, none);
    expect(plan.workspaces).toHaveLength(1);
    expect(plan.workspaces[0]?.name).toBe("Work");
    expect(plan.workspaces[0]?.links).toHaveLength(LIMITS.linksPerWorkspace);
    expect(plan).toMatchObject({ added: LIMITS.linksPerWorkspace, skipped: 4 });
    expect(plan.warnings).toEqual(["duplicates:1", "links_limit:3"]);
    const blank = planBookmarkImport(
      [bm([], "https://x/")],
      { kind: "workspace", name: " " },
      none,
    );
    expect(blank.workspaces[0]?.name).toBe("Imported");
  });

  it("one workspace with nothing importable creates nothing", () => {
    const plan = planBookmarkImport(
      [bm(["Bar"], "edge://x/")],
      { kind: "workspace", name: "W" },
      none,
    );
    expect(plan).toEqual({
      quickLinks: [],
      workspaces: [],
      added: 0,
      skipped: 1,
      warnings: ["unsupported:1"],
    });
  });

  it("per folder: first-level folders under the common root; root-level links get the root's name", () => {
    const plan = planBookmarkImport(
      [
        bm(["Bar", "Dev"], "https://root1.example/"),
        bm(["Bar", "Dev", "Docs"], "https://d1.example/"),
        bm(["Bar", "Dev", "Docs", "Deep"], "https://d2.example/"),
        bm(["Bar", "Dev", "Tools"], "https://t1.example/"),
        bm(["Bar", "Dev", "Docs"], "https://d1.example"),
        bm(["Bar", "Dev"], "https://root2.example/"),
        bm(["Bar", "Dev", "  "], "https://e.example/"),
      ],
      { kind: "workspacePerFolder" },
      none,
    );
    expect(plan.workspaces.map((w) => [w.name, w.links.map((l) => l.url)])).toEqual([
      ["Dev", ["https://root1.example/", "https://root2.example/"]],
      ["Docs", ["https://d1.example/", "https://d2.example/"]],
      ["Tools", ["https://t1.example/"]],
      ["Imported", ["https://e.example/"]],
    ]);
    expect(plan).toMatchObject({ added: 6, skipped: 1, warnings: ["duplicates:1"] });
  });

  it("per folder: an empty common root names the root-level workspace Imported", () => {
    const plan = planBookmarkImport(
      [bm([], "https://loose.example/"), bm(["Bar"], "https://b.example/")],
      { kind: "workspacePerFolder" },
      none,
    );
    expect(plan.workspaces.map((w) => w.name)).toEqual(["Imported", "Bar"]);
  });

  it("per folder with a selected root: an empty selected ancestor keeps its direct children", () => {
    const plan = planBookmarkImport(
      [
        bm(["Bookmarks bar", "Dev", "Docs", "Deep"], "https://d1.example/"),
        bm(["Bookmarks bar", "Dev", "Docs", "Deep"], "https://d2.example/"),
      ],
      { kind: "workspacePerFolder", root: ["Bookmarks bar", "Dev"] },
      none,
    );
    expect(plan.workspaces.map((w) => [w.name, w.links.length])).toEqual([["Docs", 2]]);
    // without the root, the inferred common root is the deepest folder
    const inferred = planBookmarkImport(
      [bm(["Bookmarks bar", "Dev", "Docs", "Deep"], "https://d1.example/")],
      { kind: "workspacePerFolder" },
      none,
    );
    expect(inferred.workspaces.map((w) => w.name)).toEqual(["Deep"]);
  });

  it("per folder with a selected root: root-level links (and strays) go to a workspace named after it", () => {
    const plan = planBookmarkImport(
      [
        bm(["Bar", "Dev"], "https://r1.example/"),
        bm(["Bar", "Dev", "Tools"], "https://t1.example/"),
        bm(["Other"], "https://stray.example/"),
        bm(["Bar"], "https://above.example/"),
      ],
      { kind: "workspacePerFolder", root: ["Bar", "Dev"] },
      none,
    );
    expect(plan.workspaces.map((w) => [w.name, w.links.map((l) => l.url)])).toEqual([
      ["Dev", ["https://r1.example/", "https://stray.example/", "https://above.example/"]],
      ["Tools", ["https://t1.example/"]],
    ]);
    expect(plan).toMatchObject({ added: 4, skipped: 0 });
    const top = planBookmarkImport(
      [bm([], "https://loose.example/"), bm(["A"], "https://a.example/")],
      { kind: "workspacePerFolder", root: [] },
      none,
    );
    expect(top.workspaces.map((w) => w.name)).toEqual(["Imported", "A"]);
  });

  it("per folder: at most LIMITS.importWorkspaces workspaces", () => {
    const entries = Array.from({ length: LIMITS.importWorkspaces + 2 }, (_, i) =>
      bm(["Root", `F${i}`], `https://f.example/${i}`),
    );
    const plan = planBookmarkImport(entries, { kind: "workspacePerFolder" }, none);
    expect(plan.workspaces).toHaveLength(LIMITS.importWorkspaces);
    expect(plan).toMatchObject({
      added: LIMITS.importWorkspaces,
      skipped: 2,
      warnings: ["workspaces_limit:2"],
    });
  });

  it("entries over LIMITS.importEntries are skipped", () => {
    const entries = Array.from({ length: LIMITS.importEntries + 1 }, (_, i) =>
      bm(["R"], `https://x.example/${i}`),
    );
    const plan = planBookmarkImport(entries, { kind: "workspacePerFolder" }, none);
    expect(plan.skipped).toBe(1 + LIMITS.importEntries - LIMITS.linksPerWorkspace);
    expect(plan.warnings).toContain("entries_limit:1");
  });
});
