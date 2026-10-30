/**
 * Bookmark folder tree for the import picker (docs/PHASE3.md §6). Pure: the input is typed
 * structurally, so `chrome.bookmarks.BookmarkTreeNode[]` fits and unit tests need no chrome.
 * Only `http(s)`, `file` and `ftp` URLs are importable (`classifyUrl === "placeholder"`); the worker
 * validates again.
 */
import { planBookmarkImport } from "@/core/backup/bookmarks";
import { type Color, LIMITS } from "@/core/model/types";
import { classifyUrl } from "@/core/ops/url";
import type { BookmarkEntry, ImportTarget } from "@/messaging/commands";

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
export const folderState = (node: FolderNode, selection: ReadonlySet<string>): FolderState =>
  folderStates([node], selection).get(node.id) ?? "none";

/** Every folder's state in one bottom-up pass (the tree renders from this map). */
export function folderStates(
  tree: readonly FolderNode[],
  selection: ReadonlySet<string>,
): Map<string, FolderState> {
  const out = new Map<string, FolderState>();
  const visit = (node: FolderNode): FolderState => {
    const states = node.children.map(visit);
    const own = selection.has(node.id);
    const state: FolderState =
      own && states.every((x) => x === "all")
        ? "all"
        : !own && states.every((x) => x === "none")
          ? "none"
          : "some";
    out.set(node.id, state);
    return state;
  };
  for (const f of tree) visit(f);
  return out;
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

/** Selected folders without a selected ancestor, in tree order. */
export function topSelected(
  tree: readonly FolderNode[],
  selection: ReadonlySet<string>,
): FolderNode[] {
  const out: FolderNode[] = [];
  const visit = (nodes: readonly FolderNode[]) => {
    for (const f of nodes) {
      if (selection.has(f.id)) out.push(f);
      else visit(f.children);
    }
  };
  visit(tree);
  return out;
}

/** Name of the first topmost selected folder (the "One workspace" prefill); `fallback` if none. */
export function suggestedWorkspaceName(
  tree: readonly FolderNode[],
  selection: ReadonlySet<string>,
  fallback: string,
): string {
  return topSelected(tree, selection)[0]?.title || fallback;
}

export type DestinationKind = "quicklinks" | "workspace" | "workspacePerFolder";

/** RPC schema limits of `import.bookmarks` entries (src/messaging/schemas.ts). */
export const ENTRY_LIMITS = { name: 200, title: 2000, depth: 32 } as const;

/** A folder path within the schema limits: names cut to 200 characters, at most 32 deep. */
export const fitPath = (path: readonly string[]): string[] =>
  path.slice(0, ENTRY_LIMITS.depth).map((n) => n.slice(0, ENTRY_LIMITS.name).trim());

/**
 * Entries within the schema limits, so one odd bookmark cannot reject the whole import: folder
 * names cut to 200 characters, titles to 2000, paths to 32 folders. `shortened` counts the
 * entries whose folder path changed.
 */
export function normalizeEntries(entries: readonly BookmarkEntry[]): {
  entries: BookmarkEntry[];
  shortened: number;
} {
  let shortened = 0;
  const out = entries.map((e) => {
    const path = fitPath(e.path);
    if (path.length !== e.path.length || path.some((n, i) => n !== e.path[i])) shortened++;
    return { path, title: e.title.slice(0, ENTRY_LIMITS.title), url: e.url };
  });
  return { entries: out, shortened };
}

/** One `import.bookmarks` call. */
export interface ImportCall {
  entries: BookmarkEntry[];
  target: ImportTarget;
}

/**
 * The `import.bookmarks` calls for a selection (docs/PHASE3.md §6):
 * - quick links / one workspace: one call with every selected link;
 * - one workspace per folder with ONE topmost selected folder: one `workspacePerFolder` call
 *   rooted at it (its direct subfolders become workspaces, its own links one named after it);
 * - with SEVERAL topmost selected folders: one `workspace` call per topmost folder (each becomes
 *   one workspace holding every selected link beneath it), at most LIMITS.importWorkspaces.
 * `name` is the typed one-workspace name; `fallbackName` names untitled folders.
 */
export function importCalls(
  tree: readonly FolderNode[],
  selection: ReadonlySet<string>,
  opts: { dest: DestinationKind; name: string; color: Color; fallbackName: string },
): { calls: ImportCall[]; shortened: number; droppedFolders: number } {
  const all = normalizeEntries(collectSelection(tree, selection).entries);
  const { entries, shortened } = all;
  if (entries.length === 0) return { calls: [], shortened, droppedFolders: 0 };
  if (opts.dest === "quicklinks") {
    return { calls: [{ entries, target: { kind: "quicklinks" } }], shortened, droppedFolders: 0 };
  }
  if (opts.dest === "workspace") {
    const target: ImportTarget = { kind: "workspace", name: opts.name.trim(), color: opts.color };
    return { calls: [{ entries, target }], shortened, droppedFolders: 0 };
  }
  const tops = topSelected(tree, selection);
  const only = tops[0];
  if (tops.length === 1 && only) {
    const target: ImportTarget = {
      kind: "workspacePerFolder",
      color: opts.color,
      root: fitPath(only.path),
    };
    return { calls: [{ entries, target }], shortened, droppedFolders: 0 };
  }
  const calls: ImportCall[] = [];
  let budget = entries.length; // the LIMITS.importEntries cap applies to the whole selection
  for (const top of tops.slice(0, LIMITS.importWorkspaces)) {
    const under = normalizeEntries(collectSelection([top], selection).entries).entries.slice(
      0,
      budget,
    );
    budget -= under.length;
    if (under.length === 0) continue;
    const name = top.title.slice(0, ENTRY_LIMITS.name).trim() || opts.fallbackName;
    calls.push({ entries: under, target: { kind: "workspace", name, color: opts.color } });
  }
  return {
    calls,
    shortened,
    droppedFolders: Math.max(0, tops.length - LIMITS.importWorkspaces),
  };
}

/** Import warning codes (`<code>:<count>`, src/core/backup/bookmarks.ts). */
export const WARNING_CODES = [
  "unsupported",
  "duplicates",
  "entries_limit",
  "quicklinks_limit",
  "links_limit",
  "workspaces_limit",
] as const;
export type WarningCode = (typeof WARNING_CODES)[number];

/** Parses `<code>:<count>` warnings and sums them per code (unknown codes are kept raw). */
export function sumWarnings(lists: readonly (readonly string[])[]): {
  counts: Partial<Record<WarningCode, number>>;
  other: string[];
} {
  const counts: Partial<Record<WarningCode, number>> = {};
  const other: string[] = [];
  for (const w of lists.flat()) {
    const [code, n] = w.split(":");
    const count = Number(n);
    if ((WARNING_CODES as readonly string[]).includes(code ?? "") && Number.isFinite(count)) {
      const c = code as WarningCode;
      counts[c] = (counts[c] ?? 0) + count;
    } else if (!other.includes(w)) other.push(w);
  }
  return { counts, other };
}

export interface ImportPreview {
  added: number;
  skipped: number;
  counts: Partial<Record<WarningCode, number>>;
}

/**
 * What the import would do: the worker's planner run per call against the current quick links,
 * summed. `sent` is the number of selected entries (those not in any call count as skipped).
 */
export function previewImport(
  calls: readonly ImportCall[],
  sent: number,
  quickLinkUrls: readonly string[],
  droppedFolders = 0,
): ImportPreview {
  let added = 0;
  const warnings: string[][] = [];
  for (const c of calls) {
    const plan = planBookmarkImport(c.entries, c.target, { quickLinkUrls });
    added += plan.added;
    warnings.push(plan.warnings);
  }
  if (droppedFolders > 0) warnings.push([`workspaces_limit:${droppedFolders}`]);
  return { added, skipped: Math.max(0, sent - added), counts: sumWarnings(warnings).counts };
}
