/**
 * UI read-boundary filters for list records the worker owns. Storage can hold anything (an older
 * version, a partial write, manual edits): members that are not plain objects with the field the
 * UI keys on are dropped so a single bad entry never breaks a render. Pure.
 */
import type { RecoveryPending } from "@/background/keys";
import type {
  ClosedTab,
  Note,
  PomodoroPhase,
  PomodoroState,
  QuickLink,
  Todo,
  TodoList,
  Trash,
} from "@/core/model/types";

type Obj = Record<string, unknown>;

export const isPlainObject = (x: unknown): x is Obj =>
  typeof x === "object" && x !== null && !Array.isArray(x);

const withString = <T>(list: unknown, field: string): T[] =>
  Array.isArray(list)
    ? (list.filter((x) => isPlainObject(x) && typeof x[field] === "string") as T[])
    : [];

/** `trash`: keeps items that are objects with a string `id`. */
export function sanitizeTrash(raw: unknown): Trash {
  return { items: withString(isPlainObject(raw) ? raw.items : undefined, "id") };
}

/** `recovery:pending`: null unless it has an `entries` array; keeps entries with a string `opId`. */
export function sanitizeRecovery(raw: unknown): RecoveryPending | null {
  if (!isPlainObject(raw) || !Array.isArray(raw.entries)) return null;
  return { entries: withString(raw.entries, "opId") };
}

/** `recentlyClosed`: keeps entries that are objects with a string `url`. */
export function sanitizeClosed(raw: unknown): ClosedTab[] {
  return withString(raw, "url");
}

/** `recovery:hint` (PHASE3 §1): a window of the last session that no live window matched. */
export interface RecoveryHint {
  generation: number;
  unmatchedWindows: number;
  at: number;
}

const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

/** `recovery:hint`: null unless generation / unmatchedWindows / at are finite numbers. */
export function sanitizeHint(raw: unknown): RecoveryHint | null {
  if (!isPlainObject(raw)) return null;
  const { generation, unmatchedWindows, at } = raw;
  if (!isNum(generation) || !isNum(unmatchedWindows) || !isNum(at)) return null;
  return { generation, unmatchedWindows, at };
}

/** `quicklinks`: keeps items that are objects with string `id` and `url` (title defaults to ""). */
export function sanitizeQuickLinks(raw: unknown): QuickLink[] {
  const items = isPlainObject(raw) ? raw.items : undefined;
  return withString<Obj>(items, "url")
    .filter((x) => typeof x.id === "string")
    .map((x) => ({
      id: x.id as string,
      url: x.url as string,
      title: typeof x.title === "string" ? x.title : "",
      order: isNum(x.order) ? x.order : 0,
    }));
}

/** `rev` of a revisioned record (quicklinks, todos, notes); 0 when missing or invalid. */
export function sanitizeRev(raw: unknown): number {
  const rev = isPlainObject(raw) ? raw.rev : undefined;
  return typeof rev === "number" && Number.isInteger(rev) && rev >= 0 ? rev : 0;
}

/**
 * `todos:<scope>`: keeps items with a string id and text (fields defaulted); a missing record is
 * the empty list at rev 0 (the worker's view). Ids the worker would reject are dropped by the
 * todo widget before a write (src/ui/widgets/todos-logic.ts sortTodos).
 */
export function sanitizeTodoList(raw: unknown): TodoList {
  const items = isPlainObject(raw) ? raw.items : undefined;
  const out: Todo[] = withString<Obj>(items, "text")
    .filter((x) => typeof x.id === "string")
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
