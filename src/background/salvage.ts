/**
 * Per-item salvage of records that failed validation (review K). A record whose container is
 * intact keeps every valid item; only the invalid items are reported as `dropped` (they go to
 * `corrupt:<key>`). Duplicate ids are re-assigned instead of dropped (both items are real data).
 * Pure: no storage access.
 */

import { isValidId } from "../core/model/id";
import {
  isClosedTab,
  isQuickLink,
  isSavedLink,
  isSavedTab,
  isTodo,
  isTrashItem,
  isWorkspaceMeta,
  isWorkspaceTabs,
} from "../core/model/schemas";
import type {
  ClosedTab,
  QuickLink,
  QuickLinks,
  SavedLink,
  SavedTab,
  Todo,
  TodoList,
  Trash,
  TrashItem,
  WorkspaceMeta,
  WorkspaceTabs,
} from "../core/model/types";
import { isRecord } from "./own";

export interface Salvaged<T> {
  value: T;
  /** The items that could not be kept (quarantined under corrupt:<key>). */
  dropped: unknown[];
}

const nonNegInt = (x: unknown): number | null =>
  typeof x === "number" && Number.isInteger(x) && x >= 0 ? x : null;
const finite = (x: unknown): number | null =>
  typeof x === "number" && Number.isFinite(x) ? x : null;

/** A copy without `favIconUrl` when that is the only thing wrong (favicons are cosmetic). */
function withoutFavicon(x: unknown): unknown {
  if (!isRecord(x) || !Object.hasOwn(x, "favIconUrl")) return x;
  const { favIconUrl: _drop, ...rest } = x;
  return rest;
}

function freshId(base: string, taken: ReadonlySet<string>): string {
  const stem = base.slice(0, 54);
  for (let n = 2; ; n++) {
    const id = `${stem}-d${n}`;
    if (!taken.has(id) && isValidId(id)) return id;
  }
}

/** Keeps the items `accept` admits (after `fix`), re-ids duplicates, reports the rest. */
function salvageItems<T extends { id: string }>(
  raw: unknown,
  accept: (x: unknown) => x is T,
  fix: (x: unknown) => unknown = (x) => x,
): Salvaged<T[]> {
  const items: T[] = [];
  const dropped: unknown[] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(raw) ? raw : []) {
    let c: unknown = item;
    if (!accept(c)) c = fix(c);
    if (!accept(c)) {
      dropped.push(item);
      continue;
    }
    let ok: T = c;
    if (seen.has(ok.id)) ok = { ...ok, id: freshId(ok.id, seen) };
    seen.add(ok.id);
    items.push(ok);
  }
  if (!Array.isArray(raw) && raw !== undefined) dropped.push(raw);
  return { value: items, dropped };
}

/** Item-level salvage needs an intact container: an object whose `field` is an array. */
const hasItems = (raw: unknown, field: string): raw is Record<string, unknown> =>
  isRecord(raw) && Array.isArray(raw[field]);

export function salvageWorkspaceTabs(raw: unknown, now: number): Salvaged<WorkspaceTabs> | null {
  if (!hasItems(raw, "tabs")) return null;
  const { value: tabs, dropped } = salvageItems<SavedTab>(raw.tabs, isSavedTab, withoutFavicon);
  const out: WorkspaceTabs = {
    tabs,
    updatedAt: finite(raw.updatedAt) ?? now,
    rev: (nonNegInt(raw.rev) ?? 0) + 1,
  };
  if (typeof raw.activeSavedTabId === "string" && tabs.some((t) => t.id === raw.activeSavedTabId)) {
    out.activeSavedTabId = raw.activeSavedTabId;
  }
  return isWorkspaceTabs(out) ? { value: out, dropped } : null;
}

const COLORS = ["grey", "blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange"];

/**
 * Keeps a workspace whose meta is damaged: valid links are kept, missing/invalid scalar fields
 * get defaults (the id comes from the storage key). Losing the meta would orphan its tabs.
 */
export function salvageWorkspaceMeta(
  raw: unknown,
  id: string,
  now: number,
): Salvaged<WorkspaceMeta> | null {
  // Only a record that is recognisably this workspace (its own id) is repaired.
  if (!isRecord(raw) || !isValidId(id) || raw.id !== id) return null;
  const { value: resources, dropped } = salvageItems<SavedLink>(raw.resources, isSavedLink);
  const meta: WorkspaceMeta = {
    id,
    name: typeof raw.name === "string" ? raw.name : "Recovered workspace",
    color: (COLORS.includes(raw.color as string) ? raw.color : "grey") as WorkspaceMeta["color"],
    kind: raw.kind === "unsorted" ? "unsorted" : "named",
    resources,
    createdAt: finite(raw.createdAt) ?? now,
    updatedAt: finite(raw.updatedAt) ?? now,
    rev: (nonNegInt(raw.rev) ?? 0) + 1,
  };
  if (typeof raw.emoji === "string") meta.emoji = raw.emoji;
  if (typeof raw.windowHint === "number" && Number.isInteger(raw.windowHint)) {
    meta.windowHint = raw.windowHint;
  }
  return isWorkspaceMeta(meta) ? { value: meta, dropped } : null;
}

/** Valid, unique workspace ids, in order. */
export function salvageWorkspaceIndex(raw: unknown): Salvaged<string[]> | null {
  if (!Array.isArray(raw)) return null;
  const out: string[] = [];
  const dropped: unknown[] = [];
  for (const x of raw) {
    if (isValidId(x) && !out.includes(x)) out.push(x);
    else dropped.push(x);
  }
  return { value: out, dropped };
}

export function salvageRecentlyClosed(raw: unknown): Salvaged<ClosedTab[]> | null {
  if (!Array.isArray(raw)) return null;
  const items: ClosedTab[] = [];
  const dropped: unknown[] = [];
  for (const x of raw) {
    const c = isClosedTab(x) ? x : withoutFavicon(x);
    if (isClosedTab(c)) items.push(c);
    else dropped.push(x);
  }
  return { value: items, dropped };
}

export function salvageTodoList(raw: unknown): Salvaged<TodoList> | null {
  if (!hasItems(raw, "items")) return null;
  const { value: items, dropped } = salvageItems<Todo>(raw.items, isTodo);
  return { value: { items, rev: (nonNegInt(raw.rev) ?? 0) + 1 }, dropped };
}

export function salvageQuickLinks(raw: unknown): Salvaged<QuickLinks> | null {
  if (!hasItems(raw, "items")) return null;
  const { value: items, dropped } = salvageItems<QuickLink>(raw.items, isQuickLink);
  return { value: { items, rev: (nonNegInt(raw.rev) ?? 0) + 1 }, dropped };
}

/** Trash items one by one; a workspace item with a damaged tab list keeps its valid tabs. */
export function salvageTrash(raw: unknown, now: number): Salvaged<Trash> | null {
  if (!hasItems(raw, "items")) return null;
  const items: TrashItem[] = [];
  const dropped: unknown[] = [];
  for (const x of Array.isArray(raw.items) ? raw.items : []) {
    if (isTrashItem(x)) {
      items.push(x);
      continue;
    }
    if (isRecord(x) && x.kind === "workspace" && isRecord(x.meta)) {
      const meta = salvageWorkspaceMeta(x.meta, String(x.meta.id), now);
      const tabs = salvageWorkspaceTabs(x.tabs, now);
      const fixed = { ...x, meta: meta?.value, tabs: tabs?.value };
      if (meta && tabs && isTrashItem(fixed)) {
        items.push(fixed);
        dropped.push(...meta.dropped, ...tabs.dropped);
        continue;
      }
    }
    dropped.push(x);
  }
  return { value: { items }, dropped };
}
