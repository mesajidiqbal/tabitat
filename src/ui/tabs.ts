/** Live-tab view models: chrome.tabs.Tab -> UiTab (placeholders unwrapped for display). */
import type { Color } from "@/core/model/types";
import type { LiveTab } from "@/core/ops/types";
import { parsePlaceholderUrl } from "@/core/ops/url";
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

/** How many tabs "Close duplicates" would close (same rules as the worker: core findDuplicates). */
export function duplicateCount(tabs: readonly UiTab[], placeholderBase: string): number {
  const live: LiveTab[] = tabs.map((t) => ({
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
  }));
  return findDuplicates(live, { placeholderBase }).reduce((n, g) => n + g.length - 1, 0);
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
