/**
 * Bookmarks import planner (docs/PHASE3.md §6, worker side). Pure: decides which entries go
 * where; the worker assigns ids and writes. Every entry is either added or skipped
 * (`added + skipped === entries.length`). Warnings are short codes `<code>:<count>` the UI
 * translates: unsupported, duplicates, entries_limit, quicklinks_limit, links_limit (entries
 * counted), workspaces_limit (folders counted); only emitted when the count is > 0.
 */
import { LIMITS } from "../model/types";
import { type ClassifyOptions, classifyUrl, isDangerousUrl, normalizeForMatch } from "../ops/url";

/** Same shape as the RPC `BookmarkEntry` (core does not import messaging). */
export interface BookmarkInput {
  path: readonly string[];
  title: string;
  url: string;
}

export type BookmarkTarget =
  | { kind: "quicklinks" }
  | { kind: "workspace"; name: string }
  /** `root`: the selected folder's path (omitted = common root of the entries' paths). */
  | { kind: "workspacePerFolder"; root?: readonly string[] };

export interface PlannedLink {
  url: string;
  title: string;
}

export interface PlannedWorkspace {
  name: string;
  links: PlannedLink[];
}

export interface BookmarkImportPlan {
  /** Quick links to append (target "quicklinks"). */
  quickLinks: PlannedLink[];
  /** Workspaces to create, in order (targets "workspace" / "workspacePerFolder"). */
  workspaces: PlannedWorkspace[];
  added: number;
  skipped: number;
  warnings: string[];
}

export interface ExistingItems {
  /** URLs of the current quick links (deduped against; they count toward LIMITS.quickLinks). */
  quickLinkUrls: readonly string[];
}

/** Workspace name limit (the RPC `Name` schema). */
export const NAME_MAX = 200;
export const DEFAULT_IMPORT_NAME = "Imported";

/** Trimmed, at most NAME_MAX characters; empty becomes "Imported". */
export function importName(raw: string | undefined): string {
  const n = (raw ?? "").trim().slice(0, NAME_MAX).trim();
  return n === "" ? DEFAULT_IMPORT_NAME : n;
}

/** Restorable in the running browser: placeholder or direct, never a dangerous scheme. */
export function isImportableUrl(url: string, opts: ClassifyOptions = {}): boolean {
  return !isDangerousUrl(url) && classifyUrl(url, opts) !== "skip";
}

/** Longest common prefix of every entry's folder path. */
export function commonRoot(entries: readonly BookmarkInput[]): string[] {
  const first = entries[0];
  if (!first) return [];
  let n = first.path.length;
  for (const e of entries) {
    let i = 0;
    while (i < n && i < e.path.length && e.path[i] === first.path[i]) i++;
    n = i;
  }
  return first.path.slice(0, n);
}

interface Bucket {
  name: string;
  entries: BookmarkInput[];
}

function isUnder(path: readonly string[], root: readonly string[]): boolean {
  return path.length >= root.length && root.every((seg, i) => path[i] === seg);
}

/**
 * One bucket per first-level folder under `root` (the selected folder, else the common root of
 * all entries); entries directly at the root, or (defensively) not under it, share a bucket named
 * after the root. Same-named sibling folders merge into one bucket (decided, PHASE3 §6).
 */
function bucketsPerFolder(
  entries: readonly BookmarkInput[],
  all: readonly BookmarkInput[],
  selected: readonly string[] | undefined,
) {
  const root = selected ?? commonRoot(all);
  const rootName = importName(root.at(-1));
  const buckets = new Map<string, Bucket>();
  for (const e of entries) {
    const folder = isUnder(e.path, root) ? e.path[root.length] : undefined;
    const key = folder === undefined ? "root" : `f:${folder}`;
    let b = buckets.get(key);
    if (!b) {
      b = { name: folder === undefined ? rootName : importName(folder), entries: [] };
      buckets.set(key, b);
    }
    b.entries.push(e);
  }
  return [...buckets.values()];
}

export function planBookmarkImport(
  entries: readonly BookmarkInput[],
  target: BookmarkTarget,
  existing: ExistingItems,
  opts: ClassifyOptions = {},
): BookmarkImportPlan {
  const counts = {
    unsupported: 0,
    duplicates: 0,
    entries_limit: 0,
    quicklinks_limit: 0,
    links_limit: 0,
    workspaces_limit: 0,
  };
  const accepted = entries.slice(0, LIMITS.importEntries);
  counts.entries_limit = entries.length - accepted.length;
  const valid = accepted.filter((e) => {
    const ok = isImportableUrl(e.url, opts);
    if (!ok) counts.unsupported++;
    return ok;
  });

  /** Dedupes `list` by normalized URL (also against `seen`), then caps it at `max`. */
  const fill = (
    list: readonly BookmarkInput[],
    seen: Set<string>,
    max: number,
    limitKey: "quicklinks_limit" | "links_limit",
  ): PlannedLink[] => {
    const out: PlannedLink[] = [];
    for (const e of list) {
      const key = normalizeForMatch(e.url);
      if (seen.has(key)) {
        counts.duplicates++;
        continue;
      }
      if (out.length >= max) {
        counts[limitKey]++;
        continue;
      }
      seen.add(key);
      out.push({ url: e.url, title: e.title.trim() });
    }
    return out;
  };

  const plan: BookmarkImportPlan = {
    quickLinks: [],
    workspaces: [],
    added: 0,
    skipped: 0,
    warnings: [],
  };
  if (target.kind === "quicklinks") {
    const seen = new Set(existing.quickLinkUrls.map(normalizeForMatch));
    const room = Math.max(0, LIMITS.quickLinks - existing.quickLinkUrls.length);
    plan.quickLinks = fill(valid, seen, room, "quicklinks_limit");
    plan.added = plan.quickLinks.length;
  } else {
    const buckets =
      target.kind === "workspace"
        ? [{ name: importName(target.name), entries: valid }]
        : bucketsPerFolder(valid, entries, target.root);
    for (const [i, b] of buckets.entries()) {
      if (i >= LIMITS.importWorkspaces) {
        // Counts dropped folders; their entries are skipped (skipped = entries - added).
        counts.workspaces_limit++;
        continue;
      }
      const links = fill(b.entries, new Set(), LIMITS.linksPerWorkspace, "links_limit");
      if (links.length === 0) continue;
      plan.workspaces.push({ name: b.name, links });
      plan.added += links.length;
    }
  }
  plan.skipped = entries.length - plan.added;
  for (const [code, n] of Object.entries(counts)) if (n > 0) plan.warnings.push(`${code}:${n}`);
  return plan;
}
