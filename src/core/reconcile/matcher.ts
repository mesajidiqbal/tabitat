/**
 * Startup reconciliation: match live windows (new ids after a browser restart) to saved
 * workspaces (ARCHITECTURE §5.5). Pure.
 */
import type { WorkspaceId, WorkspaceMeta, WorkspaceTabs } from "../model/types";
import type { LiveWindow } from "../ops/types";
import { classifyUrl, normalizeForMatch, parsePlaceholderUrl } from "../ops/url";

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
): Proposal {
  const known = new Set(workspaces.map((w) => w.meta.id));
  const urls = new Set<string>();
  const hints = new Map<string, number>();
  let placeholders = 0;
  for (const tab of window.tabs) {
    if (tab.pinned) continue;
    const ph = parsePlaceholderUrl(tab.url, base);
    const url = ph?.u ?? tab.url;
    // Same filter as snapshotWindow, so the sets compare like with like.
    if (classifyUrl(url) !== "skip") urls.add(normalizeForMatch(url));
    if (!ph) continue;
    placeholders++;
    if (known.has(ph.w)) hints.set(ph.w, (hints.get(ph.w) ?? 0) + 1);
  }

  let best: [string, number] | null = null;
  for (const entry of hints) if (!best || entry[1] > best[1]) best = entry;
  if (best && best[1] * 2 > placeholders) {
    return {
      windowId: window.id,
      workspaceId: best[0],
      reason: "hint",
      score: 1 + best[1] / placeholders,
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
 * Majority placeholder `w` hint wins; else best Jaccard similarity >= 0.6 of normalized URL sets.
 * A workspace goes to at most one window: the highest score keeps it (ties: earlier window),
 * the others get `null` with reason "conflict".
 */
export function matchWindows(
  windows: readonly LiveWindow[],
  workspaces: ReadonlyArray<MatchWorkspace>,
  opts: { placeholderBase: string },
): WindowMatch[] {
  const wsUrlSets = workspaces.map(
    (w) => new Set(w.tabs.tabs.map((t) => normalizeForMatch(t.url))),
  );
  const proposals = windows
    .filter((w) => w.tabs.length > 0)
    .map((w) => propose(w, workspaces, wsUrlSets, opts.placeholderBase));

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
