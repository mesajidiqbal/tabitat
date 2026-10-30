/**
 * Live window -> WorkspaceTabs, preserving SavedTab ids across snapshots (ARCHITECTURE §5.3–5.4).
 */
import type { SavedTab, SavedTabGroup, WorkspaceTabs } from "../model/types";
import type { LiveGroup, LiveTab, LiveWindow } from "./types";
import {
  classifyUrl,
  isBlankPageUrl,
  normalizeForMatch,
  parsePlaceholderUrl,
  sanitizeFavIconUrl,
} from "./url";

export interface SnapshotOptions {
  /** Runtime URL of suspended.html. */
  placeholderBase: string;
  now: number;
  newId: () => string;
  /** Internal schemes the running browser can open (see classifyUrl); others are not saved. */
  directSchemes?: readonly string[];
}

function groupsEqual(a: SavedTabGroup | undefined, b: SavedTabGroup | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.id === b.id && a.title === b.title && a.color === b.color && a.collapsed === b.collapsed;
}

/** Field-by-field equality of two saved tab lists (order-sensitive). */
export function tabsEqual(a: readonly SavedTab[], b: readonly SavedTab[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((x, i) => {
    const y = b[i] as SavedTab;
    return (
      x.id === y.id &&
      x.url === y.url &&
      x.title === y.title &&
      x.index === y.index &&
      x.favIconUrl === y.favIconUrl &&
      groupsEqual(x.group, y.group)
    );
  });
}

interface Candidate {
  live: LiveTab;
  url: string;
  title: string;
  /** `s` param when the live tab is still one of our placeholders. */
  placeholderSavedId: string | null;
  savedId?: string;
  prev?: SavedTab;
}

function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/** Assigns prev SavedTab ids: by placeholder `s`, then exact URL, then normalized URL; each id once. */
function assignIds(cands: Candidate[], prevTabs: readonly SavedTab[]): void {
  const sortedPrev = [...prevTabs].sort((a, b) => a.index - b.index);
  const byId = new Map(sortedPrev.map((t) => [t.id, t]));
  const used = new Set<string>();
  const take = (c: Candidate, t: SavedTab) => {
    used.add(t.id);
    c.savedId = t.id;
    c.prev = t;
  };

  for (const c of cands) {
    if (c.placeholderSavedId === null) continue;
    const t = byId.get(c.placeholderSavedId);
    if (t && !used.has(t.id)) take(c, t);
  }

  const passes: Array<(url: string) => string> = [(u) => u, normalizeForMatch];
  for (const keyOf of passes) {
    const pool = new Map<string, SavedTab[]>();
    for (const t of sortedPrev) if (!used.has(t.id)) pushTo(pool, keyOf(t.url), t);
    for (const c of cands) {
      if (c.savedId !== undefined) continue;
      const list = pool.get(keyOf(c.url));
      if (!list) continue;
      while (list.length > 0) {
        const t = list.shift() as SavedTab;
        if (used.has(t.id)) continue;
        take(c, t);
        break;
      }
    }
  }
}

/** Maps live group id -> saved group, reusing a prev group id with the same title+color. */
function mapGroups(
  liveGroupIds: number[],
  groups: readonly LiveGroup[],
  prevTabs: readonly SavedTab[],
  newId: () => string,
): Map<number, SavedTabGroup> {
  const prevGroups = new Map<string, string[]>();
  const seenPrev = new Set<string>();
  for (const t of [...prevTabs].sort((a, b) => a.index - b.index)) {
    if (!t.group || seenPrev.has(t.group.id)) continue;
    seenPrev.add(t.group.id);
    pushTo(prevGroups, `${t.group.color}\u0000${t.group.title}`, t.group.id);
  }
  const out = new Map<number, SavedTabGroup>();
  for (const gid of liveGroupIds) {
    if (out.has(gid)) continue;
    const g = groups.find((x) => x.id === gid);
    if (!g) continue;
    const reuse = prevGroups.get(`${g.color}\u0000${g.title}`)?.shift();
    out.set(gid, { id: reuse ?? newId(), title: g.title, color: g.color, collapsed: g.collapsed });
  }
  return out;
}

/**
 * Snapshot of the window's non-pinned, restorable tabs. Returns `prev` itself (same identity)
 * when nothing but `updatedAt` would change, so callers can skip the storage write.
 */
export function snapshotWindow(
  window: LiveWindow,
  prev: WorkspaceTabs | null,
  opts: SnapshotOptions,
): WorkspaceTabs {
  const live = window.tabs.filter((t) => !t.pinned).sort((a, b) => a.index - b.index);
  const cands: Candidate[] = [];
  for (const t of live) {
    const ph = parsePlaceholderUrl(t.url, opts.placeholderBase);
    const url = ph?.u ?? t.url;
    if (classifyUrl(url, { directSchemes: opts.directSchemes }) === "skip") continue;
    // Blank/new-tab pages carry no content: never saved (planSwitch still closes them).
    if (isBlankPageUrl(url)) continue;
    cands.push({
      live: t,
      url,
      title: ph ? ph.t || t.title : t.title,
      placeholderSavedId: ph ? ph.s : null,
    });
  }

  const prevTabs = prev?.tabs ?? [];
  assignIds(cands, prevTabs);
  const groups = mapGroups(
    cands.map((c) => c.live.groupId).filter((g) => g !== -1),
    window.groups,
    prevTabs,
    opts.newId,
  );

  let activeSavedTabId: string | undefined;
  const tabs: SavedTab[] = cands.map((c, index) => {
    const id = c.savedId ?? opts.newId();
    if (c.live.active) activeSavedTabId = id;
    // A placeholder's own favicon is ours, not the site's: keep the previously saved one.
    // Chrome often reports data: favicons, which the schema rejects: keep only storable ones.
    const favIconUrl = sanitizeFavIconUrl(
      c.placeholderSavedId !== null ? c.prev?.favIconUrl : c.live.favIconUrl,
    );
    const group = c.live.groupId === -1 ? undefined : groups.get(c.live.groupId);
    const tab: SavedTab = { id, url: c.url, title: c.title, index };
    if (favIconUrl) tab.favIconUrl = favIconUrl;
    if (group) tab.group = { ...group };
    return tab;
  });

  if (prev && prev.activeSavedTabId === activeSavedTabId && tabsEqual(prev.tabs, tabs)) {
    return prev;
  }
  const out: WorkspaceTabs = { tabs, updatedAt: opts.now, rev: (prev?.rev ?? 0) + 1 };
  if (activeSavedTabId !== undefined) out.activeSavedTabId = activeSavedTabId;
  return out;
}
