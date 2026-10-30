/**
 * UI read-boundary filters for list records the worker owns. Storage can hold anything (an older
 * version, a partial write, manual edits): members that are not plain objects with the field the
 * UI keys on are dropped so a single bad entry never breaks a render. Pure.
 */
import type { RecoveryPending } from "@/background/keys";
import type { ClosedTab, Trash } from "@/core/model/types";

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
