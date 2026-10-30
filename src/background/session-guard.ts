/**
 * SessionGuard (ARCHITECTURE §5.6): periodic generations of all windows in saved-tab form
 * (placeholders unwrapped), a ring of `settings.sessions.keep` (default 10) under
 * `sessions:index` + `sessions:gen:<n>`, and restore of any generation into a new window.
 * Restore only creates tabs (plus removes the blank tab of the new window): no op record needed.
 */

import type { SessionGeneration, SessionWindow } from "../core/model/types";
import { Keys, LIMITS } from "../core/model/types";
import { snapshotWindow } from "../core/ops/snapshot";
import { planOpening } from "../core/ops/switch-planner";
import { RpcError } from "../messaging/errors";
import type { BgContext } from "./context";
import { removeTabsSafely } from "./tab-utils";

export interface SessionGuardDeps {
  lockWindow?(windowId: number): void;
  unlockWindow?(windowId: number): void;
}

function sameContent(a: SessionGeneration, b: SessionGeneration): boolean {
  if (a.windows.length !== b.windows.length) return false;
  return a.windows.every((w, i) => {
    const o = b.windows[i] as SessionWindow;
    return (
      w.workspaceId === o.workspaceId &&
      w.tabs.length === o.tabs.length &&
      w.tabs.every((t, j) => t.url === o.tabs[j]?.url && t.title === o.tabs[j]?.title)
    );
  });
}

export class SessionGuard {
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly ctx: BgContext,
    private readonly deps: SessionGuardDeps = {},
  ) {}

  /**
   * Writes a new generation. Skipped (null) when every window is empty, or when nothing changed
   * since the last generation unless `force`.
   */
  take(opts: { force?: boolean } = {}): Promise<number | null> {
    const run = this.chain.then(() => this.takeNow(opts.force === true));
    this.chain = run.catch(() => {});
    return run;
  }

  private async takeNow(force: boolean): Promise<number | null> {
    const { repo, ports } = this.ctx;
    const windows = await this.ctx.getAllWindows();
    const states = await repo.listWindowStates();
    const opts = this.ctx.snapshotOptions();
    const genWindows: SessionWindow[] = windows.map((w) => ({
      windowId: w.id,
      workspaceId: states.get(w.id)?.activeWorkspaceId ?? null,
      tabs: snapshotWindow(w, null, opts).tabs,
    }));
    // Never record an all-empty state (it would push a useful generation out of the ring).
    if (genWindows.every((w) => w.tabs.length === 0)) return null;
    const index = await repo.getSessionsIndex();
    const last = index.at(-1);
    const gen: SessionGeneration = {
      id: (last ?? 0) + 1,
      takenAt: ports.now(),
      windows: genWindows.filter((w) => w.tabs.length > 0),
    };
    if (!force && last !== undefined) {
      const prev = await repo.getSessionGen(last);
      if (prev && sameContent(prev, gen)) return null;
    }
    const settings = await repo.getSettings();
    const keep = Math.max(1, settings.sessions.keep ?? LIMITS.sessionGenerations);
    const all = [...index, gen.id];
    const dropped = all.slice(0, Math.max(0, all.length - keep));
    await repo.setMany({
      [Keys.sessionGen(gen.id)]: gen,
      [Keys.sessionsIndex]: all.slice(-keep),
    });
    if (dropped.length > 0) await repo.remove(dropped.map((n) => Keys.sessionGen(n)));
    return gen.id;
  }

  /** Generations, newest first, with tab counts (for the recovery screen / dev popup). */
  async list(): Promise<Array<{ id: number; takenAt: number; windows: number; tabs: number }>> {
    const out = [];
    for (const n of [...(await this.ctx.repo.getSessionsIndex())].reverse()) {
      const g = await this.ctx.repo.getSessionGen(n);
      if (!g) continue;
      out.push({
        id: g.id,
        takenAt: g.takenAt,
        windows: g.windows.length,
        tabs: g.windows.reduce((s, w) => s + w.tabs.length, 0),
      });
    }
    return out;
  }

  /** Restores every tab of a generation into one new window, as placeholders. */
  async restore(generation: number): Promise<{ windowId: number }> {
    const { ports, repo } = this.ctx;
    const gen = await repo.getSessionGen(generation);
    if (!gen) throw new RpcError("not_found", `session generation ${generation} not found`);
    const win = await ports.windows.create({ url: "about:blank", focused: true });
    this.deps.lockWindow?.(win.id);
    try {
      const blankIds = win.tabs.map((t) => t.id);
      let offset = 0;
      let firstCreated: number | undefined;
      for (const w of gen.windows) {
        const plan = planOpening(w.tabs, {
          workspaceId: w.workspaceId ?? "recovered",
          pinnedCount: offset,
          restoreLimit: Number.MAX_SAFE_INTEGER,
          placeholderBase: this.ctx.placeholderBase,
          directSchemes: this.ctx.directSchemes,
        });
        const created = new Map<string, number>();
        for (const chunk of plan.chunks) {
          for (const spec of chunk) {
            if (spec.mode === "direct" && spec.url === "about:blank") continue;
            const tab = await ports.tabs.create({
              windowId: win.id,
              url: spec.url,
              index: spec.index,
              active: false,
            });
            created.set(spec.savedTabId, tab.id);
            firstCreated ??= tab.id;
          }
        }
        for (const g of plan.groups) {
          const ids = g.savedTabIds
            .map((s) => created.get(s))
            .filter((id): id is number => id !== undefined);
          if (ids.length === 0) continue;
          const gid = await ports.tabs.group(ids, win.id);
          await ports.tabs.updateGroup(gid, {
            title: g.title,
            color: g.color,
            collapsed: g.collapsed,
          });
        }
        offset += created.size;
      }
      if (firstCreated !== undefined) {
        await ports.tabs.update(firstCreated, { active: true });
        await removeTabsSafely(ports.tabs, blankIds);
      }
      return { windowId: win.id };
    } finally {
      this.deps.unlockWindow?.(win.id);
    }
  }
}
