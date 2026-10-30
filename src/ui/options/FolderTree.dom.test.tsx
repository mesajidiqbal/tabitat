// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { useState } from "preact/hooks";
import { afterEach, describe, expect, it } from "vitest";
import {
  type BookmarkNode,
  buildFolderTree,
  collectSelection,
  defaultExpanded,
  setFolderChecked,
} from "./bookmarks-tree";
import { FolderTree } from "./FolderTree";

const link = (id: string, url: string): BookmarkNode => ({ id, title: id, url });
const folder = (id: string, title: string, children: BookmarkNode[]): BookmarkNode => ({
  id,
  title,
  children,
});

// Fake chrome.bookmarks.getTree() result.
const TREE = buildFolderTree([
  folder("0", "", [
    folder("1", "Bookmarks bar", [
      link("a", "https://a.example/"),
      link("js", "javascript:void 0"),
      folder("10", "Work", [
        link("b", "https://b.example/"),
        folder("100", "Deep", [link("c", "https://c.example/"), link("d", "https://d.example/")]),
      ]),
    ]),
    folder("2", "Other bookmarks", [link("e", "https://e.example/")]),
  ]),
]);

function Picker() {
  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set());
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(defaultExpanded(TREE));
  const c = collectSelection(TREE, selection);
  return (
    <>
      <FolderTree
        nodes={TREE}
        selection={selection}
        expanded={expanded}
        onSelect={(id, on) => setSelection((sel) => setFolderChecked(TREE, sel, id, on))}
        onExpand={(id) =>
          setExpanded((ex) => {
            const next = new Set(ex);
            if (!next.delete(id)) next.add(id);
            return next;
          })
        }
      />
      <output>{`${c.links}/${c.folders}/${c.unsupported}`}</output>
    </>
  );
}

const box = (name: string) => screen.getByRole("checkbox", { name }) as HTMLInputElement;

afterEach(cleanup);

describe("FolderTree (DOM)", () => {
  it("shows recursive link counts; top level expanded", () => {
    render(<Picker />);
    expect(box("Bookmarks bar (4 links)")).toBeTruthy();
    expect(box("Work (3 links)")).toBeTruthy();
    expect(box("Other bookmarks (1 links)")).toBeTruthy();
    expect(screen.queryByRole("checkbox", { name: /^Deep/ })).toBeNull(); // Work is collapsed
  });

  it("checking a parent selects its subtree and updates the counts", () => {
    render(<Picker />);
    fireEvent.click(box("Bookmarks bar (4 links)"));
    expect(box("Bookmarks bar (4 links)").checked).toBe(true);
    expect(box("Work (3 links)").checked).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /Work/ }));
    expect(box("Deep (2 links)").checked).toBe(true);
    expect(screen.getByRole("status").textContent).toBe("4/3/1");
  });

  it("unchecking a child leaves the parent indeterminate", () => {
    render(<Picker />);
    fireEvent.click(box("Bookmarks bar (4 links)"));
    fireEvent.click(box("Work (3 links)"));
    const bar = box("Bookmarks bar (4 links)");
    expect(bar.checked).toBe(false);
    expect(bar.indeterminate).toBe(true);
    expect(box("Work (3 links)").indeterminate).toBe(false);
    expect(screen.getByRole("status").textContent).toBe("1/1/1");
  });
});
