/**
 * Suspender (ARCHITECTURE §5.7): opt-in alarm scan that discards idle tabs, manual
 * "suspend others", and duplicate closing. `tabs.discard` replaces the tab id (spike S11);
 * TabTracker follows tabs.onReplaced. Windows with a switch op are left alone.
 */

import type { LiveTab } from "../core/ops/types";
import { isPlaceholderUrl, schemeOf } from "../core/ops/url";
import { eligibleForDiscard, findDuplicates } from "../core/suspend/rules";
import { RpcError } from "../messaging/errors";
import type { BgContext } from "./context";
import { removeTabsSafely } from "./tab-utils";

/** `busy` message of suspendOne when the tab left the window whose lane the caller holds. */
export const TAB_MOVED_MESSAGE = "tab moved to another window; retry";

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

  /**
   * `tabs.suspend`: discards one tab now, whatever its idle time and the whitelist (the user
   * asked). `not_found` / `busy` (switch op in its window) / `invalid` (active, pinned, audible,
   * already discarded, a placeholder, or not http(s)). Caller holds lane
   * `window:<expectedWindowId>`; the tab is re-read here, and when it has moved to another
   * window since the caller resolved the lane: `busy` with TAB_MOVED_MESSAGE (retry there).
   */
  async suspendOne(tabId: number, expectedWindowId: number): Promise<null> {
    const { ports } = this.ctx;
    const tab = await ports.tabs.get(tabId);
    if (!tab) throw new RpcError("not_found", `tab ${tabId} not found`);
    if (tab.windowId !== expectedWindowId) throw new RpcError("busy", TAB_MOVED_MESSAGE);
    if (await this.deps.isLocked(tab.windowId)) {
      throw new RpcError("busy", "a switch is running in this window");
    }
    const settings = await this.ctx.repo.getSettings();
    const rules = { ...settings.suspend, afterMinutes: 0, whitelist: [] };
    const opts = { placeholderBase: this.ctx.placeholderBase };
    const probe = { ...tab, lastAccessed: tab.lastAccessed ?? 0 };
    if (!eligibleForDiscard(probe, rules, ports.now(), opts)) {
      throw new RpcError("invalid", `this tab cannot be suspended (${this.whyNot(tab)})`);
    }
    try {
      await ports.tabs.discard(tabId);
    } catch (e) {
      if (!(await ports.tabs.get(tabId))) throw new RpcError("not_found", `tab ${tabId} closed`);
      throw e;
    }
    return null;
  }

  private whyNot(tab: LiveTab): string {
    if (tab.active) return "active";
    if (tab.pinned) return "pinned";
    if (tab.audible) return "audible";
    if (tab.discarded) return "already suspended";
    if (isPlaceholderUrl(tab.url, this.ctx.placeholderBase)) return "placeholder";
    const scheme = schemeOf(tab.url);
    return scheme === "http:" || scheme === "https:" ? "no host" : "not a web page";
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
