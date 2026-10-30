/**
 * Prototype-safe dictionary access for records keyed by user-derived ids (saved-tab ids, tab
 * ids, storage keys). `id in obj` and `obj[id]` see Object.prototype ("constructor", …).
 */
export function ownGet<T>(
  rec: Readonly<Record<string, T>> | undefined,
  key: string | number,
): T | undefined {
  if (rec === undefined) return undefined;
  const k = String(key);
  return Object.hasOwn(rec, k) ? rec[k] : undefined;
}

export function hasOwnKey(rec: object | undefined, key: string | number): boolean {
  return rec !== undefined && Object.hasOwn(rec, String(key));
}

export function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}
