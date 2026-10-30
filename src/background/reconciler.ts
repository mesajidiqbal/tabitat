/**
 * Startup window reconciliation (ARCHITECTURE §5.5). Window ids change on browser restart and
 * may be reused, and a missing epoch only means "worker context reset" (browser restart OR
 * extension reload/update/disable). So:
 *  - windows:* records for ids not in windows.getAll() are pruned;
 *  - a record from another epoch whose id is live is kept only if the live window's content
 *    still matches its workspace (placeholder hint or URL similarity), else it is re-matched;
 *  - unmatched live windows are matched by placeholder hint, then URL-set similarity;
 *  - a workspace goes to at most one window (the loser becomes Unsorted = null here; TabTracker
 *    creates its Unsorted workspace lazily).
 * Heuristic assignments are provisional (review F): a storage-only session generation is written
 * before any similarity-based assignment, the windows record gets `provisional: true`, and the
 * workspace's pre-reconciliation tabs are kept under `ws:prev:<id>`. Nothing is deleted but
 * stale pointers.
 */

import type { WindowState } from "../core/model/types";
import { KEY_PREFIX, Keys } from "../core/model/types";
import type { LiveWindow } from "../core/ops/types";
import { matchWindows, type WindowMatch } from "../core/reconcile/matcher";
import type { BgContext } from "./context";
import { hasOwnKey } from "./own";
import type { Workspace } from "./repository";

export interface ReconcileResult {
  matches: WindowMatch[];
  kept: number[];
  removed: number[];
}

export interface ReconcileDeps {
  /** Writes a session generation from storage alone (SessionGuard.takeFromStorage). */
  takeStorageGeneration?(): Promise<unknown>;
}

export async function reconcileWindows(
  ctx: BgContext,
  windows: readonly LiveWindow[],
  deps: ReconcileDeps = {},
): Promise<ReconcileResult> {
  const { repo, ports } = ctx;
  const states = await repo.listWindowStates();
  const live = new Map(windows.map((w) => [w.id, w]));
  const valid = new Map<number, WindowState>();
  const removed: number[] = [];
  const writes: Record<string, unknown> = {};
  const owned = new Set<string>();
  const workspaces = await repo.listWorkspaces();
  const byId = new Map<string, Workspace>(workspaces.map((w) => [w.meta.id, w]));
  const matchOpts = {
    placeholderBase: ctx.placeholderBase,
    directSchemes: ctx.directSchemes,
    ownOrigin: ctx.ownOrigin,
  };
  /** Heuristic assignments (hint/similarity) made here, to be marked provisional. */
  const heuristic: WindowMatch[] = [];

  for (const [id, st] of [...states].sort((a, b) => a[0] - b[0])) {
    const win = live.get(id);
    if (!win) {
      removed.push(id);
      continue;
    }
    if (st.sessionEpoch !== ctx.epoch) {
      // Same window id after a context reset: trust it only if the content still matches.
      const ws = st.activeWorkspaceId !== null ? byId.get(st.activeWorkspaceId) : undefined;
      const m = ws && !owned.has(ws.meta.id) ? matchWindows([win], [ws], matchOpts)[0] : undefined;
      if (ws && m?.workspaceId === ws.meta.id) {
        owned.add(ws.meta.id);
        valid.set(id, st);
        heuristic.push(m);
        continue;
      }
      removed.push(id);
      continue;
    }
    if (st.activeWorkspaceId !== null) {
      if (owned.has(st.activeWorkspaceId)) {
        ctx.log.warn("[tabitat] workspace owned by two windows; window becomes Unsorted", id);
        writes[Keys.window(id)] = { activeWorkspaceId: null, sessionEpoch: ctx.epoch };
        valid.set(id, { activeWorkspaceId: null, sessionEpoch: ctx.epoch });
        continue;
      }
      owned.add(st.activeWorkspaceId);
    }
    valid.set(id, st);
  }

  const unmatched = windows.filter((w) => !valid.has(w.id));
  const candidates = workspaces.filter((w) => !owned.has(w.meta.id));
  const matches = matchWindows(unmatched, candidates, matchOpts);
  const byWindow = new Map(matches.map((m) => [m.windowId, m]));
  for (const w of unmatched) {
    const m = byWindow.get(w.id);
    if (m?.reason === "conflict") {
      ctx.log.warn("[tabitat] reconcile conflict; window becomes Unsorted", w.id);
    }
    if (m && m.workspaceId !== null) heuristic.push(m);
    else writes[Keys.window(w.id)] = { activeWorkspaceId: null, sessionEpoch: ctx.epoch };
  }

  // Before any similarity-based ownership: make the pre-reconciliation state recoverable.
  let similarityAllowed = true;
  if (heuristic.some((m) => m.reason === "similarity")) {
    try {
      await deps.takeStorageGeneration?.();
    } catch (e) {
      similarityAllowed = false;
      ctx.log.warn("[tabitat] storage generation failed; similarity matches not applied", e);
    }
  }
  const now = ports.now();
  for (const m of heuristic) {
    const ws = m.workspaceId !== null ? byId.get(m.workspaceId) : undefined;
    if (!ws || (m.reason === "similarity" && !similarityAllowed)) {
      writes[Keys.window(m.windowId)] = { activeWorkspaceId: null, sessionEpoch: ctx.epoch };
      continue;
    }
    writes[Keys.window(m.windowId)] = {
      activeWorkspaceId: ws.meta.id,
      sessionEpoch: ctx.epoch,
      provisional: true,
      provisionalAt: now,
    } satisfies WindowState;
    // One-deep: overwritten each time a provisional association is set anew.
    writes[Keys.wsPrev(ws.meta.id)] = { tabs: ws.tabs, savedAt: now };
  }

  if (Object.keys(writes).length > 0) await repo.setMany(writes);
  const stale = removed
    .filter((id) => !hasOwnKey(writes, Keys.window(id)))
    .map((id) => Keys.window(id));
  // dirty markers of windows that no longer exist
  const dirty = Object.keys(await repo.listRaw(KEY_PREFIX.dirty)).filter(
    (k) => !live.has(Number(k.slice(KEY_PREFIX.dirty.length))),
  );
  if (stale.length + dirty.length > 0) await repo.remove([...stale, ...dirty]);
  return {
    matches: [...heuristic, ...matches.filter((m) => m.workspaceId === null)],
    kept: [...valid.keys()],
    removed,
  };
}
