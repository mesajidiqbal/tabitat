/**
 * Suspender (ARCHITECTURE §5.7): opt-in alarm scan that discards idle tabs, manual
 * "suspend others", and duplicate closing. `tabs.discard` replaces the tab id (spike S11);
 * TabTracker follows tabs.onReplaced. Windows with a switch op are left alone.
 */

import type { LiveTab } from "../core/ops/types";
import { eligibleForDiscard, findDuplicates } from "../core/suspend/rules";
import type { BgContext } from "./context";
import { removeTabsSafely } from "./tab-utils";

export interface SuspenderDeps {
  isLocked(windowId: number): Promise<boolean>;
}

export class Suspender {
  constructor(
    private readonly ctx: BgContext,
    private readonly deps: SuspenderDeps,
  ) {}

  private async discardAll(tabs: LiveTab[]): Promise<number> {
    let n = 0;
    const locked = new Map<number, boolean>();
    for (const t of tabs) {
      if (!locked.has(t.windowId)) locked.set(t.windowId, await this.deps.isLocked(t.windowId));
      if (locked.get(t.windowId)) continue;
      try {
        await this.ctx.ports.tabs.discard(t.id);
        n++;
      } catch (e) {
        this.ctx.log.warn("[tabitat] discard failed", t.id, e);
      }
    }
    return n;
  }

  /** Alarm `suspend-scan`. Returns the number of tabs discarded. */
  async scan(): Promise<number> {
    const settings = await this.ctx.repo.getSettings();
    if (!settings.suspend.enabled) return 0;
    const now = this.ctx.ports.now();
    const tabs = await this.ctx.ports.tabs.query({
      active: false,
      pinned: false,
      audible: false,
      discarded: false,
    });
    const opts = { placeholderBase: this.ctx.placeholderBase };
    return this.discardAll(tabs.filter((t) => eligibleForDiscard(t, settings.suspend, now, opts)));
  }

  /** Discards every other eligible tab of the window now (ignores the idle time). */
  async suspendOthers(windowId: number): Promise<number> {
    const settings = await this.ctx.repo.getSettings();
    const now = this.ctx.ports.now();
    const rules = { ...settings.suspend, afterMinutes: 0 };
    const opts = { placeholderBase: this.ctx.placeholderBase };
    const tabs = await this.ctx.ports.tabs.query({ windowId });
    return this.discardAll(
      tabs.filter((t) =>
        eligibleForDiscard({ ...t, lastAccessed: t.lastAccessed ?? 0 }, rules, now, opts),
      ),
    );
  }

  /** Closes duplicate tabs (keeps the active / most recent one). Returns the number closed. */
  async closeDuplicates(windowId?: number): Promise<number> {
    const tabs = await this.ctx.ports.tabs.query(windowId === undefined ? {} : { windowId });
    const locked = new Set<number>();
    for (const w of new Set(tabs.map((t) => t.windowId))) {
      if (await this.deps.isLocked(w)) locked.add(w);
    }
    const groups = findDuplicates(
      tabs.filter((t) => !locked.has(t.windowId)),
      { placeholderBase: this.ctx.placeholderBase },
    );
    const extra = groups.flatMap((g) => g.slice(1));
    await removeTabsSafely(this.ctx.ports.tabs, extra);
    return extra.length;
  }
}
