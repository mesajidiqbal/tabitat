import { isNoTabError } from "../platform/errors";
import type { TabsPort } from "../platform/types";

/**
 * Removes tabs one id at a time (spike S7: a batched remove rejects on a stale id after removing
 * the valid ones). A "No tab with id" rejection means the tab is already gone: success.
 */
export async function removeTabsSafely(tabs: TabsPort, ids: readonly number[]): Promise<void> {
  for (const id of ids) {
    try {
      await tabs.remove([id]);
    } catch (e) {
      if (!isNoTabError(e)) throw e;
    }
  }
}
