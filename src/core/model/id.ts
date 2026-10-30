export function newId(): string {
  return crypto.randomUUID();
}

/**
 * Every record id (workspaces, saved tabs, links, todos, …) must match this: URL-safe, short, and
 * never an Object.prototype property name that could confuse dictionary lookups.
 */
export const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** Ids that are valid by pattern but collide with JavaScript object internals. */
const RESERVED_IDS: ReadonlySet<string> = new Set(["__proto__"]);

export function isValidId(id: unknown): id is string {
  return typeof id === "string" && ID_PATTERN.test(id) && !RESERVED_IDS.has(id);
}

/** True when no two items share an `id`. */
export function hasUniqueIds(items: ReadonlyArray<{ id: string }>): boolean {
  const seen = new Set<string>();
  for (const { id } of items) {
    if (seen.has(id)) return false;
    seen.add(id);
  }
  return true;
}
