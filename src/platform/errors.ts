/** Chrome's message when a tab id no longer exists (stale id, closed, or replaced by discard). */
const NO_TAB_RE = /No tab with id/i;

export function isNoTabError(e: unknown): boolean {
  return NO_TAB_RE.test(e instanceof Error ? e.message : String(e));
}
