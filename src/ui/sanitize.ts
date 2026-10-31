/**
 * UI read-boundary filters for list records the worker owns. Storage can hold anything (an older
 * version, a partial write, manual edits): members that are not plain objects with the field the
 * UI keys on are dropped so a single bad entry never breaks a render. Pure.
 */
import type { RecoveryPending } from "@/background/keys";
import type { ClosedTab, QuickLink, Trash } from "@/core/model/types";

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
