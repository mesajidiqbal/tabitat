/** Live-tab view models: chrome.tabs.Tab -> UiTab (placeholders unwrapped for display). */
import type { Color } from "@/core/model/types";
import type { LiveTab } from "@/core/ops/types";
import { buildPlaceholderUrl, classifyUrl, parsePlaceholderUrl, schemeOf } from "@/core/ops/url";
import { findDuplicates } from "@/core/suspend/rules";

export interface UiTab {
  id: number;
  windowId: number;
  index: number;
  /** Display URL: the real target for placeholder tabs. */
  url: string;
  /** The tab's own URL (placeholder URL for suspended tabs). */
  rawUrl: string;
  title: string;
  pinned: boolean;
  active: boolean;
  audible: boolean;
  discarded: boolean;
  /** -1 when not grouped. */
  groupId: number;
  /** A suspended.html placeholder (not loaded yet). */
  placeholder: boolean;
  lastAccessed?: number;
}

export interface UiGroup {
  id: number;
  title: string;
  color: Color;
  collapsed: boolean;
}

export function mapTab(t: chrome.tabs.Tab, placeholderBase: string): UiTab {
  const pending = t.pendingUrl ?? "";
  const raw = t.status === "loading" && pending !== "" ? pending : t.url || pending || "";
  const ph = parsePlaceholderUrl(raw, placeholderBase);
  const tab: UiTab = {
    id: t.id ?? -1,
    windowId: t.windowId,
    index: t.index,
    url: ph?.u ?? raw,
    rawUrl: raw,
    title: t.title || ph?.t || ph?.u || raw,
    pinned: t.pinned,
    active: t.active,
    audible: t.audible === true,
    discarded: t.discarded === true,
    groupId: t.groupId ?? -1,
    placeholder: ph !== null,
  };
  if (t.lastAccessed !== undefined) tab.lastAccessed = t.lastAccessed;
  return tab;
}

export function mapGroup(g: chrome.tabGroups.TabGroup): UiGroup {
  return { id: g.id, title: g.title ?? "", color: g.color as Color, collapsed: g.collapsed };
}

const toLive = (t: UiTab): LiveTab => ({
  id: t.id,
  windowId: t.windowId,
  url: t.rawUrl,
  title: t.title,
  index: t.index,
  pinned: t.pinned,
  active: t.active,
  groupId: t.groupId,
  discarded: t.discarded,
  audible: t.audible,
  ...(t.lastAccessed === undefined ? {} : { lastAccessed: t.lastAccessed }),
});

/**
 * Duplicate groups (same rules as the worker: core findDuplicates over unwrapped URLs). Within
 * a group the tab "Close duplicates" keeps comes first.
 */
export function duplicateGroups(tabs: readonly UiTab[], placeholderBase: string): UiTab[][] {
  const byId = new Map(tabs.map((t) => [t.id, t]));
  return findDuplicates(tabs.map(toLive), { placeholderBase }).map((g) =>
    g.map((id) => byId.get(id)).filter((t): t is UiTab => t !== undefined),
  );
}

/** The tabs "Close duplicates" would close: every group member except the kept (first) one. */
export const duplicateExtras = (groups: readonly UiTab[][]): UiTab[] =>
  groups.flatMap((g) => g.slice(1));

/** How many tabs "Close duplicates" would close (same rules as the worker: core findDuplicates). */
export function duplicateCount(tabs: readonly UiTab[], placeholderBase: string): number {
  return duplicateExtras(duplicateGroups(tabs, placeholderBase)).length;
}

/**
 * Whether "Suspend" is offered for a row (the worker's `tabs.suspend` rule: not active, pinned,
 * audible, discarded or a placeholder; http(s) only; the whitelist is ignored).
 */
export function canSuspend(t: UiTab): boolean {
  if (t.active || t.pinned || t.audible || t.discarded || t.placeholder) return false;
  const scheme = schemeOf(t.rawUrl);
  return scheme === "http:" || scheme === "https:";
}

/**
 * URL that reopens a closed tab without loading it: our placeholder for http(s)/file/ftp, the URL
 * itself for internal pages the browser can open directly, null for anything else.
 */
export function reopenUrl(
  tab: Pick<UiTab, "url" | "title">,
  placeholderBase: string,
  workspaceId: string,
): string | null {
  const mode = classifyUrl(tab.url);
  if (mode === "direct") return tab.url;
  if (mode !== "placeholder") return null;
  return buildPlaceholderUrl(placeholderBase, { u: tab.url, t: tab.title, w: workspaceId, s: "" });
}

/** A run of consecutive tabs: ungrouped (group null) or one tab group. */
export interface TabRun {
  group: UiGroup | null;
  groupId: number;
  tabs: UiTab[];
}

export function tabRuns(tabs: readonly UiTab[], groups: Record<number, UiGroup>): TabRun[] {
  const runs: TabRun[] = [];
  for (const t of tabs) {
    const last = runs[runs.length - 1];
    if (last && last.groupId === t.groupId) last.tabs.push(t);
    else runs.push({ group: groups[t.groupId] ?? null, groupId: t.groupId, tabs: [t] });
  }
  return runs;
}

/** One stop of the Tabs list's keyboard order: a tab-group header or a tab. */
export type TabNode = { kind: "header"; groupId: number } | { kind: "tab"; tab: UiTab };

/**
 * Flat, ordered list of the navigable nodes of the Tabs list (one roving tab stop): each group
 * contributes its header, then its tabs unless the group is collapsed (local to the list).
 */
export function buildTabNodes(
  runs: readonly TabRun[],
  collapsed: Readonly<Record<number, boolean>>,
): TabNode[] {
  const nodes: TabNode[] = [];
  for (const run of runs) {
    if (run.group) {
      nodes.push({ kind: "header", groupId: run.groupId });
      if (collapsed[run.groupId]) continue;
    }
    for (const tab of run.tabs) nodes.push({ kind: "tab", tab });
  }
  return nodes;
}
