/**
 * Typed, validated access to storage.local (ARCHITECTURE §6). Reads never throw on bad data:
 * a record that fails its schema is copied to `corrupt:<key>` and removed from its live key
 * (never silently dropped), and the read returns null (or a salvaged value where one exists).
 */
import {
  isClosedTab,
  parseClosedTab,
  parseMeta,
  parseNote,
  parsePomodoroState,
  parseQuickLinks,
  parseRecentlyClosed,
  parseSessionGeneration,
  parseSessionsIndex,
  parseSettings,
  parseSwitchOp,
  parseTodoList,
  parseTrash,
  parseWindowState,
  parseWorkspaceIndex,
  parseWorkspaceMeta,
  parseWorkspaceTabs,
} from "../core/model/schemas";
import type {
  ClosedTab,
  Meta,
  Note,
  PomodoroState,
  QuickLinks,
  Scope,
  SessionGeneration,
  Settings,
  SwitchOp,
  TodoList,
  Trash,
  WindowState,
  WorkspaceId,
  WorkspaceMeta,
  WorkspaceTabs,
} from "../core/model/types";
import { KEY_PREFIX, Keys } from "../core/model/types";
import type { StoragePort } from "../platform/types";
import { BgKeys, parseRecoveryPending, type RecoveryPending } from "./keys";

export interface Workspace {
  meta: WorkspaceMeta;
  tabs: WorkspaceTabs;
}

export interface Logger {
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export const emptyTabs = (now: number): WorkspaceTabs => ({ tabs: [], updatedAt: now, rev: 0 });

export class Repository {
  constructor(
    readonly store: StoragePort,
    private readonly now: () => number,
    private readonly log: Logger = console,
  ) {}

  // ------------------------------------------------------------------ generic

  /** Parses `raw` for `key`; on failure quarantines it and returns `salvage?.(raw) ?? null`. */
  async validate<T>(
    key: string,
    raw: unknown,
    parse: (x: unknown) => T,
    salvage?: (raw: unknown) => T | null,
  ): Promise<T | null> {
    if (raw === undefined) return null;
    try {
      return parse(raw);
    } catch (e) {
      const saved = await this.quarantine(key, raw, e);
      const fixed = salvage?.(raw) ?? null;
      if (fixed !== null && saved) {
        try {
          await this.store.set({ [key]: fixed });
        } catch (err) {
          this.log.warn("[tabitat] could not write salvaged record", key, err);
        }
      }
      return fixed;
    }
  }

  async read<T>(
    key: string,
    parse: (x: unknown) => T,
    salvage?: (raw: unknown) => T | null,
  ): Promise<T | null> {
    return this.validate(key, await this.store.get(key), parse, salvage);
  }

  /** Copies a bad record to `corrupt:<key>` and removes the original. Returns false if the copy failed (original kept). */
  async quarantine(key: string, raw: unknown, error: unknown): Promise<boolean> {
    const message = error instanceof Error ? error.message : String(error);
    this.log.warn("[tabitat] quarantining corrupt record", key, message);
    const at = this.now();
    try {
      const existing = await this.store.get(BgKeys.corrupt(key));
      const target = existing === undefined ? BgKeys.corrupt(key) : `${BgKeys.corrupt(key)}:${at}`;
      await this.store.set({ [target]: { key, raw, error: message, at } });
    } catch (e) {
      this.log.error("[tabitat] quarantine failed; keeping original", key, e);
      return false;
    }
    try {
      await this.store.remove(key);
    } catch (e) {
      this.log.warn("[tabitat] could not remove quarantined original", key, e);
    }
    return true;
  }

  setMany(items: Record<string, unknown>): Promise<void> {
    return this.store.set(items);
  }

  remove(keys: string | string[]): Promise<void> {
    return this.store.remove(keys);
  }

  getAll(): Promise<Record<string, unknown>> {
    return this.store.getAll();
  }

  /** All keys (with raw values) starting with `prefix`. Reads the whole store: use sparingly. */
  async listRaw(prefix: string): Promise<Record<string, unknown>> {
    const all = await this.store.getAll();
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(all)) if (k.startsWith(prefix)) out[k] = val;
    return out;
  }

  // ------------------------------------------------------------------ records

  getMeta(): Promise<Meta | null> {
    return this.read(Keys.meta, parseMeta);
  }

  async getSettings(): Promise<Settings> {
    return (await this.read(Keys.settings, parseSettings)) ?? parseSettings(undefined);
  }

  async getWorkspaceIndex(): Promise<string[]> {
    const raw = await this.store.get(Keys.wsIndex);
    if (raw === undefined) return [];
    try {
      return parseWorkspaceIndex(raw);
    } catch (e) {
      // Rebuild from the surviving entries plus every ws:meta:* key: never lose a workspace.
      const saved = await this.quarantine(Keys.wsIndex, raw, e);
      const kept = Array.isArray(raw)
        ? raw.filter((x): x is string => typeof x === "string" && x !== "")
        : [];
      const metas = Object.keys(await this.listRaw(KEY_PREFIX.wsMeta)).map((k) =>
        k.slice(KEY_PREFIX.wsMeta.length),
      );
      const index = [...new Set([...kept, ...metas])];
      if (saved) await this.store.set({ [Keys.wsIndex]: index });
      return index;
    }
  }

  getWorkspaceMeta(id: WorkspaceId): Promise<WorkspaceMeta | null> {
    return this.read(Keys.wsMeta(id), parseWorkspaceMeta);
  }

  getWorkspaceTabs(id: WorkspaceId): Promise<WorkspaceTabs | null> {
    return this.read(Keys.wsTabs(id), parseWorkspaceTabs);
  }

  /** Meta + tabs (tabs default to an empty snapshot). null when the meta is missing/corrupt. */
  async getWorkspace(id: WorkspaceId): Promise<Workspace | null> {
    const raw = await this.store.getMany([Keys.wsMeta(id), Keys.wsTabs(id)]);
    const meta = await this.validate(Keys.wsMeta(id), raw[Keys.wsMeta(id)], parseWorkspaceMeta);
    if (!meta) return null;
    const tabs = await this.validate(Keys.wsTabs(id), raw[Keys.wsTabs(id)], parseWorkspaceTabs);
    return { meta, tabs: tabs ?? emptyTabs(meta.updatedAt) };
  }

  /** Workspaces in index order (missing/corrupt metas are skipped). */
  async listWorkspaces(): Promise<Workspace[]> {
    const index = await this.getWorkspaceIndex();
    if (index.length === 0) return [];
    const keys = index.flatMap((id) => [Keys.wsMeta(id), Keys.wsTabs(id)]);
    const raw = await this.store.getMany(keys);
    const out: Workspace[] = [];
    for (const id of index) {
      const meta = await this.validate(Keys.wsMeta(id), raw[Keys.wsMeta(id)], parseWorkspaceMeta);
      if (!meta) continue;
      const tabs = await this.validate(Keys.wsTabs(id), raw[Keys.wsTabs(id)], parseWorkspaceTabs);
      out.push({ meta, tabs: tabs ?? emptyTabs(meta.updatedAt) });
    }
    return out;
  }

  getWindowState(windowId: number): Promise<WindowState | null> {
    return this.read(Keys.window(windowId), parseWindowState);
  }

  /** Every windows:* record, keyed by window id. */
  async listWindowStates(): Promise<Map<number, WindowState>> {
    const out = new Map<number, WindowState>();
    for (const [k, raw] of Object.entries(await this.listRaw(KEY_PREFIX.window))) {
      const id = Number(k.slice(KEY_PREFIX.window.length));
      if (!Number.isInteger(id)) continue;
      const st = await this.validate(k, raw, parseWindowState);
      if (st) out.set(id, st);
    }
    return out;
  }

  getOp(windowId: number): Promise<SwitchOp | null> {
    return this.read(Keys.opSwitch(windowId), parseSwitchOp);
  }

  async listOps(): Promise<SwitchOp[]> {
    const out: SwitchOp[] = [];
    for (const [k, raw] of Object.entries(await this.listRaw(KEY_PREFIX.opSwitch))) {
      const op = await this.validate(k, raw, parseSwitchOp);
      if (op) out.push(op);
    }
    return out;
  }

  async getRecentlyClosed(): Promise<ClosedTab[]> {
    return (
      (await this.read(Keys.recentlyClosed, parseRecentlyClosed, (raw) =>
        Array.isArray(raw) ? raw.filter(isClosedTab).map((t) => parseClosedTab(t)) : null,
      )) ?? []
    );
  }

  async getTrash(): Promise<Trash> {
    return (await this.read(Keys.trash, parseTrash)) ?? { items: [] };
  }

  async getSessionsIndex(): Promise<number[]> {
    return (
      (await this.read(Keys.sessionsIndex, parseSessionsIndex, (raw) =>
        Array.isArray(raw)
          ? [...new Set(raw.filter((x): x is number => Number.isInteger(x) && x >= 0))].sort(
              (a, b) => a - b,
            )
          : null,
      )) ?? []
    );
  }

  getSessionGen(n: number): Promise<SessionGeneration | null> {
    return this.read(Keys.sessionGen(n), parseSessionGeneration);
  }

  getTodos(scope: Scope): Promise<TodoList | null> {
    return this.read(Keys.todos(scope), parseTodoList);
  }

  getNote(scope: Scope): Promise<Note | null> {
    return this.read(Keys.notes(scope), parseNote);
  }

  async getQuickLinks(): Promise<QuickLinks> {
    return (await this.read(Keys.quicklinks, parseQuickLinks)) ?? { items: [], rev: 0 };
  }

  getPomodoro(): Promise<PomodoroState | null> {
    return this.read(Keys.pomodoro, (x) => (x === null ? (null as never) : parsePomodoroState(x)));
  }

  async getRecoveryPending(): Promise<RecoveryPending> {
    return (await this.read(BgKeys.recoveryPending, parseRecoveryPending)) ?? { entries: [] };
  }
}
