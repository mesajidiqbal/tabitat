/**
 * Bookmark folder tree for the import picker (docs/PHASE3.md §6). Pure: the input is typed
 * structurally, so `chrome.bookmarks.BookmarkTreeNode[]` fits and unit tests need no chrome.
 * Only `http(s)`, `file` and `ftp` URLs are importable (`classifyUrl === "placeholder"`); the worker
 * validates again.
 */
import { LIMITS } from "@/core/model/types";
import { classifyUrl } from "@/core/ops/url";
import type { BookmarkEntry } from "@/messaging/commands";

export interface BookmarkNode {
  id: string;
  title: string;
  url?: string | undefined;
  children?: readonly BookmarkNode[] | undefined;
}

export interface FolderLink {
  title: string;
  url: string;
}

export interface FolderNode {
  id: string;
  title: string;
  /** Folder titles from the top level, e.g. ["Bookmarks bar", "Work"]. */
  path: string[];
  /** Importable links directly in this folder. */
  links: FolderLink[];
  /** Links directly in this folder that cannot be imported (unsupported URL scheme). */
  unsupported: number;
  children: FolderNode[];
  /** Importable links in this folder and every subfolder. */
  totalLinks: number;
  totalUnsupported: number;
}

export type FolderState = "all" | "some" | "none";

const isFolder = (n: BookmarkNode): boolean => n.url === undefined;

function build(node: BookmarkNode, parentPath: string[]): FolderNode {
  const path = [...parentPath, node.title.trim()];
  const links: FolderLink[] = [];
  let unsupported = 0;
  const children: FolderNode[] = [];
  for (const child of node.children ?? []) {
    if (isFolder(child)) {
      const f = build(child, path);
      if (f.totalLinks + f.totalUnsupported > 0) children.push(f);
    } else if (typeof child.url === "string" && classifyUrl(child.url) === "placeholder") {
      links.push({ title: child.title, url: child.url });
    } else {
      unsupported++;
    }
  }
  return {
    id: node.id,
    title: node.title.trim(),
    path,
    links,
    unsupported,
    children,
    totalLinks: links.length + children.reduce((n, c) => n + c.totalLinks, 0),
    totalUnsupported: unsupported + children.reduce((n, c) => n + c.totalUnsupported, 0),
  };
}

/**
 * Folders of a `getTree()` result. The synthetic root (no title, no URL) is dropped so its
 * children ("Bookmarks bar", "Other bookmarks", …) are the top level. Folders without any
 * links (recursively) are left out.
 */
export function buildFolderTree(roots: readonly BookmarkNode[]): FolderNode[] {
  const tops: BookmarkNode[] = [];
  for (const r of roots) {
    if (!isFolder(r)) continue;
    if (r.title.trim() === "") tops.push(...(r.children ?? []).filter(isFolder));
    else tops.push(r);
  }
  return tops.map((n) => build(n, [])).filter((f) => f.totalLinks + f.totalUnsupported > 0);
}

export function folderIds(node: FolderNode): string[] {
  return [node.id, ...node.children.flatMap(folderIds)];
}

export function findFolder(tree: readonly FolderNode[], id: string): FolderNode | null {
  for (const f of tree) {
    if (f.id === id) return f;
    const hit = findFolder(f.children, id);
    if (hit) return hit;
  }
  return null;
}

/** Checking a folder checks its whole subtree; unchecking clears it. Returns a new set. */
export function setFolderChecked(
  tree: readonly FolderNode[],
  selection: ReadonlySet<string>,
  id: string,
  checked: boolean,
): Set<string> {
  const next = new Set(selection);
  const node = findFolder(tree, id);
  if (!node) return next;
  for (const i of folderIds(node)) {
    if (checked) next.add(i);
    else next.delete(i);
  }
  return next;
}

/** "all": the folder and every subfolder selected; "none": nothing selected; else "some". */
export function folderState(node: FolderNode, selection: ReadonlySet<string>): FolderState {
  const states = node.children.map((c) => folderState(c, selection));
  const own = selection.has(node.id);
  if (own && states.every((s) => s === "all")) return "all";
  if (!own && states.every((s) => s === "none")) return "none";
  return "some";
}

/** Top-level folders start expanded. */
export const defaultExpanded = (tree: readonly FolderNode[]): Set<string> =>
  new Set(tree.map((f) => f.id));

export interface Collected {
  /** Entries to send (importable links of the selected folders, capped at LIMITS.importEntries). */
  entries: BookmarkEntry[];
  /** Importable links before the cap. */
  links: number;
  /** Selected folders. */
  folders: number;
  /** Links of the selected folders with an unsupported URL. */
  unsupported: number;
  /** Importable links dropped by the LIMITS.importEntries cap. */
  capped: number;
}

/** Links directly inside each selected folder (a parent's selection does not imply its children). */
export function collectSelection(
  tree: readonly FolderNode[],
  selection: ReadonlySet<string>,
): Collected {
  const entries: BookmarkEntry[] = [];
  let folders = 0;
  let unsupported = 0;
  const visit = (f: FolderNode) => {
    if (selection.has(f.id)) {
      folders++;
      unsupported += f.unsupported;
      for (const l of f.links) {
        entries.push({ path: f.path, title: l.title.trim() || l.url, url: l.url });
      }
    }
    for (const c of f.children) visit(c);
  };
  for (const f of tree) visit(f);
  const links = entries.length;
  return {
    entries: entries.slice(0, LIMITS.importEntries),
    links,
    folders,
    unsupported,
    capped: Math.max(0, links - LIMITS.importEntries),
  };
}

/** Name of the first topmost selected folder (the "One workspace" prefill); "Imported" if none. */
export function suggestedWorkspaceName(
  tree: readonly FolderNode[],
  selection: ReadonlySet<string>,
): string {
  const top = (nodes: readonly FolderNode[]): FolderNode | null => {
    for (const f of nodes) {
      if (selection.has(f.id)) return f;
      const hit = top(f.children);
      if (hit) return hit;
    }
    return null;
  };
  return top(tree)?.title || "Imported";
}

export type DestinationKind = "quicklinks" | "workspace" | "workspacePerFolder";

/** How many of `count` links the destination cannot take (quick links: LIMITS.quickLinks total). */
export function destinationOverflow(
  kind: DestinationKind,
  count: number,
  existingQuickLinks: number,
): number {
  if (kind === "quicklinks") {
    return Math.max(0, count - Math.max(0, LIMITS.quickLinks - existingQuickLinks));
  }
  if (kind === "workspace") return Math.max(0, count - LIMITS.linksPerWorkspace);
  return 0;
}
