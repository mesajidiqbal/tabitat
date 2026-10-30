/**
 * Startup reconciliation: match live windows (new ids after a browser restart) to saved
 * workspaces (ARCHITECTURE §5.5). Pure.
 */
import type { SessionGeneration, WorkspaceId, WorkspaceMeta, WorkspaceTabs } from "../model/types";
import type { LiveWindow } from "../ops/types";
import {
  captureUrl,
  classifyUrl,
  isBlankPageUrl,
  normalizeForMatch,
  parsePlaceholderUrl,
} from "../ops/url";

export const SIMILARITY_THRESHOLD = 0.6;

export type MatchReason = "hint" | "similarity" | "none" | "conflict";

export interface WindowMatch {
  windowId: number;
  workspaceId: WorkspaceId | null;
  reason: MatchReason;
}

export interface MatchWorkspace {
  meta: WorkspaceMeta;
  tabs: WorkspaceTabs;
}

/** |A ∩ B| / |A ∪ B|; 0 when both are empty. */
export function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

interface Proposal {
  windowId: number;
  workspaceId: WorkspaceId | null;
  reason: "hint" | "similarity" | "none";
  /** Hints score in (1, 2], similarity in [threshold, 1]; a hint always beats similarity. */
  score: number;
}

function propose(
  window: LiveWindow,
  workspaces: readonly MatchWorkspace[],
  wsUrlSets: ReadonlyArray<Set<string>>,
  base: string,
  directSchemes: readonly string[] | undefined,
  ownOrigin: string | undefined,
): Proposal {
  const known = new Set(workspaces.map((w) => w.meta.id));
  const urls = new Set<string>();
  const hints = new Map<string, number>();
  /** Non-pinned, non-blank tabs: the denominator of the hint majority. */
  let counted = 0;
  for (const tab of window.tabs) {
    if (tab.pinned) continue;
    const raw = captureUrl(tab);
    const ph = parsePlaceholderUrl(raw, base);
    const url = ph?.u ?? raw;
    if (isBlankPageUrl(url) || url.trim() === "") continue;
    counted++;
    // Same filter as snapshotWindow, so the sets compare like with like.
    if (classifyUrl(url, { directSchemes, ownOrigin }) !== "skip") {
      urls.add(normalizeForMatch(url));
    }
    if (!ph) continue;
    if (known.has(ph.w)) hints.set(ph.w, (hints.get(ph.w) ?? 0) + 1);
  }

  let best: [string, number] | null = null;
  for (const entry of hints) if (!best || entry[1] > best[1]) best = entry;
  // A hint needs a strict majority of the window's (non-pinned, non-blank) tabs, so one stale
  // placeholder cannot claim a window full of other tabs; a tie falls through to similarity.
  if (best && best[1] * 2 > counted) {
    return {
      windowId: window.id,
      workspaceId: best[0],
      reason: "hint",
      score: 1 + best[1] / counted,
    };
  }

  let bestIdx = -1;
  let bestScore = 0;
  wsUrlSets.forEach((set, i) => {
    const s = jaccard(urls, set);
    if (s > bestScore) {
      bestScore = s;
      bestIdx = i;
    }
  });
  const ws = workspaces[bestIdx];
  if (ws && bestScore >= SIMILARITY_THRESHOLD) {
    return { windowId: window.id, workspaceId: ws.meta.id, reason: "similarity", score: bestScore };
  }
  return { windowId: window.id, workspaceId: null, reason: "none", score: 0 };
}

/**
 * One result per window that has tabs (windows with 0 tabs are ignored), in input order.
 * A `w` hint held by a strict majority of the window's non-pinned, non-blank tabs wins; else best Jaccard similarity >= 0.6 of normalized URL sets.
 * A workspace goes to at most one window: the highest score keeps it (ties: earlier window),
 * the others get `null` with reason "conflict".
 */
export function matchWindows(
  windows: readonly LiveWindow[],
  workspaces: ReadonlyArray<MatchWorkspace>,
  opts: { placeholderBase: string; directSchemes?: readonly string[]; ownOrigin?: string },
): WindowMatch[] {
  const wsUrlSets = workspaces.map(
    (w) => new Set(w.tabs.tabs.map((t) => normalizeForMatch(t.url))),
  );
  const proposals = windows
    .filter((w) => w.tabs.length > 0)
    .map((w) =>
      propose(w, workspaces, wsUrlSets, opts.placeholderBase, opts.directSchemes, opts.ownOrigin),
    );

  const winner = new Map<WorkspaceId, Proposal>();
  for (const p of proposals) {
    if (p.workspaceId === null) continue;
    const cur = winner.get(p.workspaceId);
    if (!cur || p.score > cur.score) winner.set(p.workspaceId, p);
  }

  return proposals.map((p) => {
    if (p.workspaceId === null || winner.get(p.workspaceId) === p) {
      return { windowId: p.windowId, workspaceId: p.workspaceId, reason: p.reason };
    }
    return { windowId: p.windowId, workspaceId: null, reason: "conflict" };
  });
}

/** Normalized URL set of a live window's non-pinned, non-blank tabs (placeholders unwrapped). */
function liveUrlSet(window: LiveWindow, base: string): Set<string> {
  const out = new Set<string>();
  for (const tab of window.tabs) {
    if (tab.pinned) continue;
    const raw = captureUrl(tab);
    const url = parsePlaceholderUrl(raw, base)?.u ?? raw;
    if (url.trim() === "" || isBlankPageUrl(url)) continue;
    out.add(normalizeForMatch(url));
  }
  return out;
}

/**
 * How many windows of a session generation (the "recovery hint", PHASE3 §1) no live window
 * accounts for after startup reconciliation. A generation window counts when it has at least one
 * non-blank tab and neither (a) its workspace is now active in a live window (`ownedWorkspaces`)
 * nor (b) some live window's URL set is at least SIMILARITY_THRESHOLD similar to its own.
 * Storage-only windows (windowId 0, written by reconciliation itself) are ignored.
 */
export function countUnmatchedSessionWindows(
  gen: SessionGeneration,
  live: readonly LiveWindow[],
  ownedWorkspaces: ReadonlySet<WorkspaceId>,
  opts: { placeholderBase: string },
): number {
  const liveSets = live.map((w) => liveUrlSet(w, opts.placeholderBase));
  let unmatched = 0;
  for (const w of gen.windows) {
    if (w.windowId === 0) continue;
    const urls = new Set(
      w.tabs
        .map((t) => t.url)
        .filter((u) => u.trim() !== "" && !isBlankPageUrl(u))
        .map(normalizeForMatch),
    );
    if (urls.size === 0) continue;
    if (w.workspaceId !== null && ownedWorkspaces.has(w.workspaceId)) continue;
    if (liveSets.some((set) => jaccard(urls, set) >= SIMILARITY_THRESHOLD)) continue;
    unmatched++;
  }
  return unmatched;
}
