/**
 * Widget records of the read model: todo lists and notes by scope, and the pomodoro state. Only
 * the widgets (dashboard, side panel sections) import this module, so the popup never loads it
 * (review C-S1, popup budget). It follows storage.local like store.ts does: one listener (set up
 * when the module is first loaded in an extension page), one initial read, changes that arrive
 * during that read applied after it (newer wins). Never writes storage.
 */
import { batch, effect, type Signal, signal } from "@preact/signals";
import {
  KEY_PREFIX,
  Keys,
  type Note,
  type PomodoroPhase,
  type PomodoroState,
  type Scope,
  type Todo,
  type TodoList,
} from "@/core/model/types";
import { isPlainObject, sanitizeRev } from "../sanitize";
import { activeWorkspaceId } from "../store";

type Obj = Record<string, unknown>;
const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

/**
 * `todos:<scope>`: keeps items with a string id and text (fields defaulted); a missing record is
 * the empty list at rev 0 (the worker's view). Ids the worker would reject are dropped by the
 * todo widget before a write (todos-logic.ts sortTodos).
 */
export function sanitizeTodoList(raw: unknown): TodoList {
  const items = isPlainObject(raw) ? raw.items : undefined;
  const out: Todo[] = (Array.isArray(items) ? items : [])
    .filter(
      (x): x is Obj => isPlainObject(x) && typeof x.text === "string" && typeof x.id === "string",
    )
    .map((x) => {
      const todo: Todo = {
        id: x.id as string,
        text: x.text as string,
        done: x.done === true,
        order: isNum(x.order) ? x.order : 0,
        createdAt: isNum(x.createdAt) ? x.createdAt : 0,
      };
      if (isNum(x.doneAt)) todo.doneAt = x.doneAt;
      return todo;
    });
  return { items: out, rev: sanitizeRev(raw) };
}

/** `notes:<scope>`: string content (default ""), finite updatedAt, rev; missing = empty, rev 0. */
export function sanitizeNote(raw: unknown): Note {
  if (!isPlainObject(raw)) return { content: "", updatedAt: 0, rev: 0 };
  return {
    content: typeof raw.content === "string" ? raw.content : "",
    updatedAt: isNum(raw.updatedAt) ? raw.updatedAt : 0,
    rev: sanitizeRev(raw),
  };
}

const PHASES: readonly PomodoroPhase[] = ["work", "break", "longBreak"];

/** `pomodoro`: null (not running) unless phase / endsAt / round are valid. */
export function sanitizePomodoro(raw: unknown): PomodoroState | null {
  if (!isPlainObject(raw)) return null;
  const { phase, endsAt, round } = raw;
  if (!PHASES.includes(phase as PomodoroPhase) || !isNum(endsAt) || !isNum(round)) return null;
  return { phase: phase as PomodoroPhase, endsAt, round };
}

export const records = {
  /**
   * Todo lists / notes by scope, loaded for "global" and the current window's active workspace
   * (on demand, `ensureScope`). A scope present here is loaded; a missing record is the empty
   * list / note at rev 0. Every later change arrives through onChanged.
   */
  todos: signal<Record<Scope, TodoList>>({}),
  notes: signal<Record<Scope, Note>>({}),
  /** `pomodoro`: null when no session runs. */
  pomodoro: signal<PomodoroState | null>(null),
  /** The pomodoro key has been read. */
  pomodoroLoaded: signal(false),
};

const setKey = <T>(sig: Signal<Record<string, T>>, k: string, v: T) => {
  sig.value = { ...sig.peek(), [k]: v };
};

/** Applies one storage.local value (undefined = removed); other keys are ignored. */
export function applyRecordChange(key: string, raw: unknown): void {
  if (key.startsWith(KEY_PREFIX.todos))
    setKey(records.todos, key.slice(KEY_PREFIX.todos.length), sanitizeTodoList(raw));
  else if (key.startsWith(KEY_PREFIX.notes))
    setKey(records.notes, key.slice(KEY_PREFIX.notes.length), sanitizeNote(raw));
  else if (key === Keys.pomodoro) {
    records.pomodoro.value = sanitizePomodoro(raw);
    records.pomodoroLoaded.value = true;
  }
}

const scopeLoads = new Map<Scope, Promise<void>>();
/**
 * Loads `todos:<scope>` and `notes:<scope>` once (no-op when both are loaded). A record that an
 * onChanged event delivered while the read was in flight is newer and is kept.
 */
export function ensureScope(scope: Scope): Promise<void> {
  if (scope in records.todos.peek() && scope in records.notes.peek()) return Promise.resolve();
  const running = scopeLoads.get(scope);
  if (running) return running;
  const tk = Keys.todos(scope);
  const nk = Keys.notes(scope);
  const p = chrome.storage.local
    .get([tk, nk])
    .then((res) =>
      batch(() => {
        if (!(scope in records.todos.peek())) applyRecordChange(tk, res[tk]);
        if (!(scope in records.notes.peek())) applyRecordChange(nk, res[nk]);
      }),
    )
    .catch(() => undefined)
    .finally(() => scopeLoads.delete(scope));
  scopeLoads.set(scope, p);
  return p;
}

let started = false;
/** Subscribes and reads the records once per page (no-op outside an extension page). */
export function initRecords(): void {
  if (started || !globalThis.chrome?.storage?.onChanged) return;
  started = true;
  let buffered: Array<[string, unknown]> | null = [];
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    const list = Object.entries(changes).map(([k, c]): [string, unknown] => [k, c.newValue]);
    if (buffered) buffered.push(...list);
    else
      batch(() => {
        for (const [k, v] of list) applyRecordChange(k, v);
      });
  });
  const keys = [Keys.pomodoro, Keys.todos("global"), Keys.notes("global")];
  void chrome.storage.local
    .get(keys)
    .catch(() => ({}) as Record<string, unknown>)
    .then((res) => {
      batch(() => {
        // Missing keys count as loaded: the empty list / note, no pomodoro.
        for (const k of keys) applyRecordChange(k, (res as Record<string, unknown>)[k]);
        for (const [k, v] of buffered ?? []) applyRecordChange(k, v);
        buffered = null;
      });
      // The active workspace's todo list and note (the scope switch).
      effect(() => {
        const id = activeWorkspaceId.value;
        if (id) void ensureScope(id);
      });
    });
}

initRecords();
