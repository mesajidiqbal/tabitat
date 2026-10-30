/**
 * Typed, validated access to storage.local (ARCHITECTURE §6). Reads never throw on bad data.
 * A record that fails its schema is salvaged item by item where it has items (workspace tabs,
 * links, index, recently closed, trash, todos, quick links): the valid items are kept and the
 * salvaged value is written over the key in the SAME storage.set as the `corrupt:<key>` copy of
 * the dropped items (the key is never missing in between). A record that cannot be salvaged is
 * copied to `corrupt:<key>` and then removed, and the read returns null.
 */
import {
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
  parseWorkspacePrev,
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
  WorkspacePrev,
  WorkspaceTabs,
} from "../core/model/types";
import { KEY_PREFIX, Keys } from "../core/model/types";
import type { StoragePort } from "../platform/types";
import { BgKeys, parseRecoveryPending, type RecoveryPending } from "./keys";
import {
  type Salvaged,
  salvageQuickLinks,
  salvageRecentlyClosed,
  salvageSettings,
  salvageTodoList,
  salvageTrash,
  salvageWorkspaceIndex,
  salvageWorkspaceMeta,
  salvageWorkspaceTabs,
} from "./salvage";

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

  /**
   * Parses `raw` for `key`. On failure: with a salvager that keeps something, writes the
   * salvaged value and the dropped items' corrupt copy in one set and returns the salvaged value;
   * otherwise quarantines the whole record and returns null.
   */
  async validate<T>(
    key: string,
    raw: unknown,
    parse: (x: unknown) => T,
    salvage?: (raw: unknown) => Salvaged<T> | null | Promise<Salvaged<T> | null>,
  ): Promise<T | null> {
    if (raw === undefined) return null;
    try {
      return parse(raw);
    } catch (e) {
      const fixed = salvage ? await salvage(raw) : null;
      if (fixed === null) {
        await this.quarantine(key, raw, e);
        return null;
      }
      const message = e instanceof Error ? e.message : String(e);
      this.log.warn("[tabitat] salvaged corrupt record", key, message, fixed.dropped.length);
      try {
        const target = await this.corruptTarget(key);
        await this.store.set({
          [target]: { key, raw: fixed.dropped, error: message, at: this.now(), salvaged: true },
          [key]: fixed.value,
        });
      } catch (err) {
        // The original stays in place; the salvaged value is still served for this read.
        this.log.warn("[tabitat] could not write salvaged record", key, err);
      }
      return fixed.value;
    }
  }

  async read<T>(
    key: string,
    parse: (x: unknown) => T,
    salvage?: (raw: unknown) => Salvaged<T> | null | Promise<Salvaged<T> | null>,
  ): Promise<T | null> {
    return this.validate(key, await this.store.get(key), parse, salvage);
  }

  /** `corrupt:<key>`, or `corrupt:<key>:<at>` when that is taken (copies are appended, never overwritten). */
  private async corruptTarget(key: string): Promise<string> {
    const existing = await this.store.get(BgKeys.corrupt(key));
    return existing === undefined ? BgKeys.corrupt(key) : `${BgKeys.corrupt(key)}:${this.now()}`;
  }

  /** Copies a bad record to `corrupt:<key>` and removes the original. Returns false if the copy failed (original kept). */
  async quarantine(key: string, raw: unknown, error: unknown): Promise<boolean> {
    const message = error instanceof Error ? error.message : String(error);
    this.log.warn("[tabitat] quarantining corrupt record", key, message);
    const at = this.now();
    try {
      const target = await this.corruptTarget(key);
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
    return (
      (await this.read(Keys.settings, parseSettings, salvageSettings)) ?? parseSettings(undefined)
    );
  }

  async getWorkspaceIndex(): Promise<string[]> {
    const raw = await this.store.get(Keys.wsIndex);
    if (raw === undefined) return [];
    // Salvage: the surviving valid ids plus every ws:meta:* key (never lose a workspace).
    const salvage = async (r: unknown): Promise<Salvaged<string[]>> => {
      const kept = salvageWorkspaceIndex(r) ?? { value: [], dropped: [r] };
      const metas = Object.keys(await this.listRaw(KEY_PREFIX.wsMeta))
        .map((k) => k.slice(KEY_PREFIX.wsMeta.length))
        .filter((id) => !kept.value.includes(id) && salvageWorkspaceIndex([id])?.value.length);
      return { value: [...kept.value, ...metas], dropped: kept.dropped };
    };
    return (await this.validate(Keys.wsIndex, raw, parseWorkspaceIndex, salvage)) ?? [];
  }

  private metaSalvager(id: WorkspaceId) {
    return (raw: unknown) => salvageWorkspaceMeta(raw, id, this.now());
  }

  private readonly tabsSalvager = (raw: unknown) => salvageWorkspaceTabs(raw, this.now());

  getWorkspaceMeta(id: WorkspaceId): Promise<WorkspaceMeta | null> {
    return this.read(Keys.wsMeta(id), parseWorkspaceMeta, this.metaSalvager(id));
  }

  getWorkspaceTabs(id: WorkspaceId): Promise<WorkspaceTabs | null> {
    return this.read(Keys.wsTabs(id), parseWorkspaceTabs, this.tabsSalvager);
  }

  getWorkspacePrev(id: WorkspaceId): Promise<WorkspacePrev | null> {
    return this.read(Keys.wsPrev(id), parseWorkspacePrev);
  }

  /** Meta + tabs (tabs default to an empty snapshot). null when the meta is missing/corrupt. */
  async getWorkspace(id: WorkspaceId): Promise<Workspace | null> {
    const raw = await this.store.getMany([Keys.wsMeta(id), Keys.wsTabs(id)]);
    const meta = await this.validate(
      Keys.wsMeta(id),
      raw[Keys.wsMeta(id)],
      parseWorkspaceMeta,
      this.metaSalvager(id),
    );
    if (!meta) return null;
    const tabs = await this.validate(
      Keys.wsTabs(id),
      raw[Keys.wsTabs(id)],
      parseWorkspaceTabs,
      this.tabsSalvager,
    );
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
      const meta = await this.validate(
        Keys.wsMeta(id),
        raw[Keys.wsMeta(id)],
        parseWorkspaceMeta,
        this.metaSalvager(id),
      );
      if (!meta) continue;
      const tabs = await this.validate(
        Keys.wsTabs(id),
        raw[Keys.wsTabs(id)],
        parseWorkspaceTabs,
        this.tabsSalvager,
      );
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
    return (await this.read(Keys.recentlyClosed, parseRecentlyClosed, salvageRecentlyClosed)) ?? [];
  }

  async getTrash(): Promise<Trash> {
    return (
      (await this.read(Keys.trash, parseTrash, (raw) => salvageTrash(raw, this.now()))) ?? {
        items: [],
      }
    );
  }

  async getSessionsIndex(): Promise<number[]> {
    return (
      (await this.read(Keys.sessionsIndex, parseSessionsIndex, (raw) => {
        if (!Array.isArray(raw)) return null;
        const ok = (x: unknown): x is number => Number.isInteger(x) && (x as number) >= 0;
        return {
          value: [...new Set(raw.filter(ok))].sort((a, b) => a - b),
          dropped: raw.filter((x) => !ok(x)),
        };
      })) ?? []
    );
  }

  getSessionGen(n: number): Promise<SessionGeneration | null> {
    return this.read(Keys.sessionGen(n), parseSessionGeneration);
  }

  getTodos(scope: Scope): Promise<TodoList | null> {
    return this.read(Keys.todos(scope), parseTodoList, salvageTodoList);
  }

  getNote(scope: Scope): Promise<Note | null> {
    return this.read(Keys.notes(scope), parseNote);
  }

  async getQuickLinks(): Promise<QuickLinks> {
    return (
      (await this.read(Keys.quicklinks, parseQuickLinks, salvageQuickLinks)) ?? {
        items: [],
        rev: 0,
      }
    );
  }

  getPomodoro(): Promise<PomodoroState | null> {
    return this.read(Keys.pomodoro, (x) => (x === null ? (null as never) : parsePomodoroState(x)));
  }

  async getRecoveryPending(): Promise<RecoveryPending> {
    return (await this.read(BgKeys.recoveryPending, parseRecoveryPending)) ?? { entries: [] };
  }
}
