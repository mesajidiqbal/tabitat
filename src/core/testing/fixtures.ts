/** Test fixtures for core unit tests. Not part of the public API. */
import type { Color, SavedTab, Settings, WorkspaceMeta, WorkspaceTabs } from "../model/types";
import { DEFAULT_SETTINGS } from "../model/types";
import type { LiveGroup, LiveTab, LiveWindow } from "../ops/types";

export const BASE = "chrome-extension://abcdefghijklmnop/suspended.html";
export const NOW = 1_800_000_000_000;

/** Deterministic id generator: id-1, id-2, … */
export function seqIds(prefix = "id"): () => string {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

/** Small deterministic PRNG (mulberry32) for property-style tests. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(xs: readonly T[], rand: () => number): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

let nextTabId = 1000;
export function liveTab(over: Partial<LiveTab> = {}): LiveTab {
  const id = over.id ?? nextTabId++;
  return {
    id,
    windowId: 1,
    url: `https://example.com/${id}`,
    title: `Tab ${id}`,
    index: 0,
    pinned: false,
    active: false,
    groupId: -1,
    discarded: false,
    audible: false,
    ...over,
  };
}

/** A window whose tabs get sequential indices (in the given order) and the window's id. */
export function liveWindow(
  tabs: Array<Partial<LiveTab>>,
  groups: LiveGroup[] = [],
  id = 1,
): LiveWindow {
  return {
    id,
    tabs: tabs.map((t, index) => liveTab({ index, ...t, windowId: id })),
    groups,
  };
}

export function liveGroup(id: number, title: string, color: Color = "blue"): LiveGroup {
  return { id, title, color, collapsed: false };
}

export function savedTab(over: Partial<SavedTab> & { id: string }): SavedTab {
  return { url: `https://example.com/${over.id}`, title: over.id, index: 0, ...over };
}

export function workspaceTabs(tabs: SavedTab[], over: Partial<WorkspaceTabs> = {}): WorkspaceTabs {
  return {
    tabs: tabs.map((t, index) => ({ ...t, index })),
    updatedAt: NOW - 1000,
    rev: 1,
    ...over,
  };
}

export function workspaceMeta(id: string, over: Partial<WorkspaceMeta> = {}): WorkspaceMeta {
  return {
    id,
    name: `Workspace ${id}`,
    color: "blue",
    kind: "named",
    resources: [],
    createdAt: NOW - 10_000,
    updatedAt: NOW - 1000,
    rev: 1,
    ...over,
  };
}

export function settings(over: Partial<Settings> = {}): Settings {
  return { ...structuredClone(DEFAULT_SETTINGS), ...over };
}
