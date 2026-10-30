/**
 * Export/import (ARCHITECTURE §6, §10). Pure: works on raw storage maps; the worker validates,
 * stages under `import:staging`, then applies `set`/`remove`.
 */
import type { ImportReport } from "../../messaging/commands";
import { newId as defaultNewId } from "../model/id";
import {
  isNote,
  isQuickLink,
  isQuickLinks,
  isSavedLink,
  isSavedTab,
  isTodoList,
  isWorkspaceMeta,
  isWorkspaceTabs,
  parseBackupFile,
  parseSettings,
} from "../model/schemas";
import type {
  BackupFile,
  Note,
  QuickLinks,
  Scope,
  Settings,
  Todo,
  TodoList,
  WorkspaceId,
  WorkspaceMeta,
  WorkspaceTabs,
} from "../model/types";
import { DEFAULT_SETTINGS, KEY_PREFIX, Keys } from "../model/types";
import { isAllowedFavIconUrl, normalizeForMatch } from "../ops/url";

export type ImportMode = "replace" | "merge";

export interface ImportPlan {
  /** Keys to write (one storage.set). */
  set: Record<string, unknown>;
  /** Keys to delete; disjoint from `set`. */
  remove: string[];
  report: ImportReport;
}

export interface PlanImportOptions {
  /** Id source for workspaces/items whose id collides. Defaults to crypto.randomUUID. */
  newId?: () => string;
  /** Timestamp used for merged notes. Defaults to the newest of the merged notes. */
  now?: number;
}

type Rec = Record<string, unknown>;
const isRec = (x: unknown): x is Rec => typeof x === "object" && x !== null && !Array.isArray(x);

// ------------------------------------------------------------------ export

function salvageMeta(raw: unknown, id: string): WorkspaceMeta | null {
  if (!isRec(raw) || raw.id !== id) return null;
  if (isWorkspaceMeta(raw)) return raw;
  const resources = Array.isArray(raw.resources) ? raw.resources.filter(isSavedLink) : [];
  const fixed = { ...raw, resources };
  return isWorkspaceMeta(fixed) ? fixed : null;
}

function salvageTabs(raw: unknown, fallbackUpdatedAt: number): WorkspaceTabs {
  if (isWorkspaceTabs(raw)) return raw;
  const r = isRec(raw) ? raw : {};
  const tabs = Array.isArray(r.tabs) ? r.tabs.filter(isSavedTab) : [];
  const out: WorkspaceTabs = {
    tabs,
    updatedAt: typeof r.updatedAt === "number" ? r.updatedAt : fallbackUpdatedAt,
    rev: typeof r.rev === "number" && Number.isInteger(r.rev) && r.rev >= 0 ? r.rev : 0,
  };
  if (typeof r.activeSavedTabId === "string" && tabs.some((t) => t.id === r.activeSavedTabId)) {
    out.activeSavedTabId = r.activeSavedTabId;
  }
  return out;
}

function salvageQuickLinks(raw: unknown): QuickLinks {
  if (isQuickLinks(raw)) return raw;
  const r = isRec(raw) ? raw : {};
  const items = Array.isArray(r.items) ? r.items.filter(isQuickLink) : [];
  const rev = typeof r.rev === "number" && Number.isInteger(r.rev) && r.rev >= 0 ? r.rev : 0;
  return { items, rev };
}

function safeSettings(raw: unknown): Settings {
  try {
    return parseSettings(raw ?? {});
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

/** Builds a backup from a raw storage.local map. Invalid records are skipped or salvaged. */
export function buildBackup(records: Record<string, unknown>, now: number): BackupFile {
  const index = Array.isArray(records[Keys.wsIndex])
    ? (records[Keys.wsIndex] as unknown[]).filter((x): x is string => typeof x === "string")
    : [];
  const unindexed = Object.keys(records)
    .filter((k) => k.startsWith(KEY_PREFIX.wsMeta))
    .map((k) => k.slice(KEY_PREFIX.wsMeta.length));
  const ids = [...new Set([...index, ...unindexed])];

  const workspaces: BackupFile["data"]["workspaces"] = [];
  for (const id of ids) {
    const meta = salvageMeta(records[Keys.wsMeta(id)], id);
    if (!meta) continue;
    workspaces.push({ meta, tabs: salvageTabs(records[Keys.wsTabs(id)], meta.updatedAt) });
  }

  const todos: Record<Scope, TodoList> = {};
  const notes: Record<Scope, Note> = {};
  for (const [key, value] of Object.entries(records)) {
    if (key.startsWith(KEY_PREFIX.todos) && isTodoList(value)) {
      todos[key.slice(KEY_PREFIX.todos.length)] = value;
    } else if (key.startsWith(KEY_PREFIX.notes) && isNote(value)) {
      notes[key.slice(KEY_PREFIX.notes.length)] = value;
    }
  }

  return {
    format: "tabitat-backup",
    version: 1,
    exportedAt: now,
    data: {
      settings: safeSettings(records[Keys.settings]),
      workspaces,
      todos,
      notes,
      quicklinks: salvageQuickLinks(records[Keys.quicklinks]),
    },
  };
}

/** Import bounds (ARCHITECTURE §10): larger files are rejected before validation. */
export const IMPORT_LIMITS = {
  maxBytes: 25 * 1024 * 1024,
  maxWorkspaces: 1000,
  maxTabs: 20_000,
} as const;

/**
 * Checks an untrusted backup against IMPORT_LIMITS without validating it. `bytes` is the
 * serialized size. Returns a human-readable reason, or null when within bounds.
 */
export function checkBackupLimits(input: unknown, bytes: number): string | null {
  if (bytes > IMPORT_LIMITS.maxBytes) {
    return `backup file is larger than ${IMPORT_LIMITS.maxBytes / (1024 * 1024)} MB`;
  }
  const data = isRec(input) && isRec(input.data) ? input.data : null;
  const workspaces = data && Array.isArray(data.workspaces) ? data.workspaces : [];
  if (workspaces.length > IMPORT_LIMITS.maxWorkspaces) {
    return `backup has more than ${IMPORT_LIMITS.maxWorkspaces} workspaces`;
  }
  let tabs = 0;
  for (const w of workspaces) {
    const t = isRec(w) && isRec(w.tabs) && Array.isArray(w.tabs.tabs) ? w.tabs.tabs.length : 0;
    tabs += t;
    if (tabs > IMPORT_LIMITS.maxTabs) {
      return `backup has more than ${IMPORT_LIMITS.maxTabs} tabs`;
    }
  }
  return null;
}

/**
 * Drops favicon URLs outside the favicon allowlist (cosmetic; older exports may carry them)
 * so they do not make an otherwise valid backup unimportable. Returns a copy when it changes.
 */
function stripDisallowedFavicons(input: unknown): unknown {
  if (!isRec(input) || !isRec(input.data) || !Array.isArray(input.data.workspaces)) return input;
  let changed = false;
  const workspaces = input.data.workspaces.map((w: unknown) => {
    if (!isRec(w) || !isRec(w.tabs) || !Array.isArray(w.tabs.tabs)) return w;
    const tabs = w.tabs.tabs.map((t: unknown) => {
      if (!isRec(t) || typeof t.favIconUrl !== "string" || isAllowedFavIconUrl(t.favIconUrl)) {
        return t;
      }
      changed = true;
      const { favIconUrl: _drop, ...rest } = t;
      return rest;
    });
    return { ...w, tabs: { ...w.tabs, tabs } };
  });
  return changed ? { ...input, data: { ...input.data, workspaces } } : input;
}

/** Validates an untrusted backup (URL and id policy included). Throws SchemaError. */
export function validateBackup(input: unknown): BackupFile {
  return parseBackupFile(stripDisallowedFavicons(input));
}

// ------------------------------------------------------------------ import

function revOf(x: unknown): number | null {
  return isRec(x) && typeof x.rev === "number" ? x.rev : null;
}

/** Keeps `rev` monotonic when overwriting an existing record. */
function nextRev(existing: unknown, imported: number): number {
  const prev = revOf(existing);
  return prev === null ? imported : Math.max(prev, imported) + 1;
}

function existingWorkspaceIds(existing: Rec): string[] {
  const idx = Array.isArray(existing[Keys.wsIndex])
    ? (existing[Keys.wsIndex] as unknown[]).filter((x): x is string => typeof x === "string")
    : [];
  const metas = Object.keys(existing)
    .filter((k) => k.startsWith(KEY_PREFIX.wsMeta))
    .map((k) => k.slice(KEY_PREFIX.wsMeta.length));
  return [...new Set([...idx, ...metas])];
}

function withFreshIds<T extends { id: string; order: number }>(
  items: readonly T[],
  taken: Set<string>,
  startOrder: number,
  newId: () => string,
): T[] {
  return items.map((item, i) => {
    let id = item.id;
    while (taken.has(id)) id = newId();
    taken.add(id);
    return { ...item, id, order: startOrder + i };
  });
}

function maxOrder(items: ReadonlyArray<{ order: number }>): number {
  return items.reduce((m, i) => Math.max(m, i.order), -1);
}

/**
 * Plans an import. `replace` drops every existing ws:*, todos:* and notes:* key and writes the
 * file's records (settings and quicklinks included). `merge` keeps everything that exists, adds
 * the file's workspaces (new ids on collision, " (imported)" suffix on name clashes), appends
 * todos/quicklinks, concatenates differing notes and leaves settings untouched.
 * Imported workspaces lose `windowHint` and become kind "named".
 * Report counts: workspaces, todo items, notes, quicklink items written.
 */
export function planImport(
  file: BackupFile,
  existing: Record<string, unknown>,
  mode: ImportMode,
  opts: PlanImportOptions = {},
): ImportPlan {
  const newId = opts.newId ?? defaultNewId;
  const set: Rec = {};
  const warnings: string[] = [];
  const report: ImportReport = { workspaces: 0, todos: 0, notes: 0, quicklinks: 0, warnings };

  // --- workspaces
  const prevIds = mode === "merge" ? existingWorkspaceIds(existing) : [];
  const takenIds = new Set(prevIds);
  const takenNames = new Set<string>();
  if (mode === "merge") {
    for (const id of prevIds) {
      const m = existing[Keys.wsMeta(id)];
      if (isRec(m) && typeof m.name === "string") takenNames.add(m.name);
    }
  }
  const idMap = new Map<WorkspaceId, WorkspaceId>();
  const importedIds: string[] = [];
  const fileIds = new Set<string>();
  for (const { meta, tabs } of file.data.workspaces) {
    if (fileIds.has(meta.id)) {
      warnings.push(`duplicate workspace id "${meta.id}" in file; imported with a new id`);
    }
    fileIds.add(meta.id);
    let id = meta.id;
    while (takenIds.has(id)) id = newId();
    takenIds.add(id);
    if (!idMap.has(meta.id)) idMap.set(meta.id, id);
    importedIds.push(id);

    let name = meta.name;
    if (mode === "merge" && takenNames.has(name)) {
      name = `${name} (imported)`;
      warnings.push(`workspace "${meta.name}" already exists; imported as "${name}"`);
    }
    takenNames.add(name);

    const { windowHint: _drop, ...rest } = meta;
    const outMeta: WorkspaceMeta = {
      ...rest,
      id,
      name,
      kind: "named",
      rev: nextRev(existing[Keys.wsMeta(id)], meta.rev),
    };
    set[Keys.wsMeta(id)] = outMeta;
    set[Keys.wsTabs(id)] = { ...tabs, rev: nextRev(existing[Keys.wsTabs(id)], tabs.rev) };
    report.workspaces++;
  }
  set[Keys.wsIndex] = [...prevIds, ...importedIds];

  const mapScope = (scope: string): Scope | null => {
    if (scope === "global") return "global";
    return idMap.get(scope) ?? null;
  };

  // --- todos
  for (const [scope, list] of Object.entries(file.data.todos)) {
    const target = mapScope(scope);
    if (target === null) {
      warnings.push(`todos for unknown workspace "${scope}" skipped`);
      continue;
    }
    const key = Keys.todos(target);
    const prev = mode === "merge" ? existing[key] : undefined;
    let items: Todo[];
    if (isTodoList(prev)) {
      const taken = new Set(prev.items.map((t) => t.id));
      items = [...prev.items, ...withFreshIds(list.items, taken, maxOrder(prev.items) + 1, newId)];
    } else {
      items = list.items.map((t) => ({ ...t }));
    }
    set[key] = { items, rev: nextRev(existing[key], list.rev) } satisfies TodoList;
    report.todos += list.items.length;
  }

  // --- notes
  for (const [scope, note] of Object.entries(file.data.notes)) {
    const target = mapScope(scope);
    if (target === null) {
      warnings.push(`note for unknown workspace "${scope}" skipped`);
      continue;
    }
    const key = Keys.notes(target);
    const prev = mode === "merge" ? existing[key] : undefined;
    let content = note.content;
    let updatedAt = note.updatedAt;
    if (isNote(prev) && prev.content.trim() !== "") {
      if (note.content.trim() === "" || prev.content === note.content) continue;
      content = `${prev.content}\n\n${note.content}`;
      updatedAt = opts.now ?? Math.max(prev.updatedAt, note.updatedAt);
    }
    set[key] = { content, updatedAt, rev: nextRev(existing[key], note.rev) } satisfies Note;
    report.notes++;
  }

  // --- quicklinks
  const ql = file.data.quicklinks;
  const prevQlRaw = existing[Keys.quicklinks];
  // Merge onto the valid part of what exists (invalid items are dropped, as on export).
  const prevQl = prevQlRaw === undefined ? undefined : salvageQuickLinks(prevQlRaw);
  if (mode === "merge" && prevQl) {
    const seen = new Set(prevQl.items.map((q) => normalizeForMatch(q.url)));
    const fresh = ql.items.filter((q) => {
      const k = normalizeForMatch(q.url);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    if (fresh.length > 0) {
      const taken = new Set(prevQl.items.map((q) => q.id));
      set[Keys.quicklinks] = {
        items: [...prevQl.items, ...withFreshIds(fresh, taken, maxOrder(prevQl.items) + 1, newId)],
        rev: nextRev(prevQlRaw, ql.rev),
      } satisfies QuickLinks;
    }
    report.quicklinks = fresh.length;
  } else {
    set[Keys.quicklinks] = {
      items: ql.items.map((q) => ({ ...q })),
      rev: nextRev(prevQlRaw, ql.rev),
    };
    report.quicklinks = ql.items.length;
  }

  // --- settings
  if (mode === "replace") {
    set[Keys.settings] = {
      ...file.data.settings,
      rev: nextRev(existing[Keys.settings], file.data.settings.rev),
    };
  } else {
    warnings.push("settings are not imported in merge mode");
  }

  const remove =
    mode === "replace"
      ? Object.keys(existing).filter(
          (k) =>
            !Object.hasOwn(set, k) &&
            (k.startsWith(KEY_PREFIX.wsMeta) ||
              k.startsWith(KEY_PREFIX.wsTabs) ||
              k.startsWith(KEY_PREFIX.todos) ||
              k.startsWith(KEY_PREFIX.notes)),
        )
      : [];

  return { set, remove, report };
}
