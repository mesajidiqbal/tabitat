/**
 * Startup window reconciliation (ARCHITECTURE §5.5). Window ids change on browser restart:
 * windows:* records from another session (epoch) or for windows that no longer exist are
 * dropped; unmatched live windows are matched to workspaces by placeholder hint, then URL-set
 * similarity; a workspace goes to at most one window (the loser becomes Unsorted = null here,
 * TabTracker creates its Unsorted workspace lazily). Nothing is deleted but stale pointers.
 */

import type { WindowState } from "../core/model/types";
import { KEY_PREFIX, Keys } from "../core/model/types";
import type { LiveWindow } from "../core/ops/types";
import { matchWindows, type WindowMatch } from "../core/reconcile/matcher";
import type { BgContext } from "./context";

export interface ReconcileResult {
  matches: WindowMatch[];
  kept: number[];
  removed: number[];
}

export async function reconcileWindows(
  ctx: BgContext,
  windows: readonly LiveWindow[],
): Promise<ReconcileResult> {
  const { repo } = ctx;
  const states = await repo.listWindowStates();
  const live = new Set(windows.map((w) => w.id));
  const valid = new Map<number, WindowState>();
  const removed: number[] = [];
  const writes: Record<string, unknown> = {};
  const owned = new Set<string>();

  for (const [id, st] of [...states].sort((a, b) => a[0] - b[0])) {
    if (!live.has(id) || st.sessionEpoch !== ctx.epoch) {
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
  const candidates = (await repo.listWorkspaces()).filter((w) => !owned.has(w.meta.id));
  const matches = matchWindows(unmatched, candidates, {
    placeholderBase: ctx.placeholderBase,
    directSchemes: ctx.directSchemes,
  });
  const byWindow = new Map(matches.map((m) => [m.windowId, m]));
  for (const w of unmatched) {
    const m = byWindow.get(w.id);
    if (m?.reason === "conflict") {
      ctx.log.warn("[tabitat] reconcile conflict; window becomes Unsorted", w.id);
    }
    writes[Keys.window(w.id)] = {
      activeWorkspaceId: m?.workspaceId ?? null,
      sessionEpoch: ctx.epoch,
    } satisfies WindowState;
  }

  if (Object.keys(writes).length > 0) await repo.setMany(writes);
  const stale = removed.filter((id) => !(Keys.window(id) in writes)).map((id) => Keys.window(id));
  // dirty markers of windows that no longer exist
  const dirty = Object.keys(await repo.listRaw(KEY_PREFIX.dirty)).filter(
    (k) => !live.has(Number(k.slice(KEY_PREFIX.dirty.length))),
  );
  if (stale.length + dirty.length > 0) await repo.remove([...stale, ...dirty]);
  return { matches, kept: [...valid.keys()], removed };
}
