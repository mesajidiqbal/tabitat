/**
 * Live-tab actions of the Tabs section (PHASE3 §2, §3, §7): close with undo, close duplicates
 * with undo, suspend, park, and the per-site suspension whitelist. Closing / creating tabs uses
 * chrome.tabs directly (plain browser events the tracker auto-saves); saved state goes through
 * `send()` (ADR-003).
 */
import { LIMITS, type WindowState } from "@/core/model/types";
import { normalizeForMatch } from "@/core/ops/url";
import { normalizeWhitelistEntry } from "@/core/suspend/rules";
import { plural, t } from "@/i18n";
import { send } from "@/messaging/client";
import { attempt, openExtPage } from "./actions";
import { showToast } from "./components/Toast";
import { duplicateGroups, placeholderBase, store } from "./store";
import {
  duplicateExtras,
  duplicateGroups as groupDupes,
  mapTab,
  reopenUrl,
  type UiTab,
} from "./tabs";

type Reopen = Pick<UiTab, "url" | "title" | "windowId">;

/** dataTransfer type of a dragged tab row (carries the tab id; dropped on Saved links = park). */
export const TAB_DRAG_TYPE = "application/x-tabitat-tab";

/** Where and how one closed tab is reopened. */
export interface ReopenTarget {
  tab: Reopen;
  windowId: number;
  /** Placeholder (or direct) URL carrying the source window's active workspace as `w`. */
  url: string;
}

/**
 * Reopen targets for closed tabs (pure). Each placeholder's `w` hint is the active workspace of
 * the tab's own window when it was closed (`windowStates` keyed by window id), none when unknown.
 */
export function reopenTargets(
  tabs: readonly Reopen[],
  windowStates: Readonly<Record<string, Pick<WindowState, "activeWorkspaceId"> | undefined>>,
  base: string,
): ReopenTarget[] {
  const out: ReopenTarget[] = [];
  for (const tab of tabs) {
    const ws = windowStates[String(tab.windowId)]?.activeWorkspaceId ?? "";
    const url = reopenUrl(tab, base, ws);
    if (url !== null) out.push({ tab, windowId: tab.windowId, url });
  }
  return out;
}

/** Targets for `tabs` from the current window states (call when closing, before Undo). */
const targetsNow = (tabs: readonly Reopen[]): ReopenTarget[] =>
  reopenTargets(tabs, store.windowStates.peek(), placeholderBase());

/**
 * Recreates closed tabs as (unloaded) placeholders at the end of their windows. A tab whose
 * window is gone reopens in the current window without a workspace hint, and the toast says so.
 */
export async function reopenAsPlaceholders(targets: readonly ReopenTarget[]): Promise<void> {
  const base = placeholderBase();
  let movedHere = 0;
  for (const target of targets) {
    try {
      await chrome.tabs.create({ windowId: target.windowId, url: target.url, active: false });
    } catch {
      const url = reopenUrl(target.tab, base, "");
      if (url === null) continue;
      try {
        await chrome.tabs.create({ url, active: false });
        movedHere++;
      } catch {
        // no window to open it in
      }
    }
  }
  if (movedHere > 0) showToast({ message: t("reopenedHere") });
}

/** Closes one tab; the toast offers Undo (reopens it as a placeholder). */
export async function closeTab(tab: UiTab): Promise<void> {
  const targets = targetsNow([tab]);
  try {
    await chrome.tabs.remove(tab.id);
  } catch {
    return; // already gone
  }
  const title = tab.title || tab.url;
  showToast({
    message: t("closedTab", title),
    duration: 8000,
    action: { label: t("undo"), run: () => void reopenAsPlaceholders(targets) },
  });
}

/** Ids among `ids` that no longer exist after the command (a locked window keeps its tabs). */
async function gone(candidates: readonly UiTab[], windowId?: number): Promise<UiTab[]> {
  const live = await chrome.tabs
    .query(windowId === undefined ? {} : { windowId })
    .catch(() => [] as chrome.tabs.Tab[]);
  const ids = new Set(live.map((x) => x.id));
  return candidates.filter((x) => !ids.has(x.id));
}

/**
 * "Close N dupes" for the current window (`all` false) or every window (side panel menu). The
 * to-be-closed tabs are computed before the call; Undo recreates the ones that actually closed.
 */
export async function closeDuplicates(all = false): Promise<void> {
  const w = store.windowId.peek();
  if (!all && w === null) return;
  let candidates: UiTab[];
  if (all) {
    const base = placeholderBase();
    const tabs = await chrome.tabs.query({}).catch(() => [] as chrome.tabs.Tab[]);
    candidates = duplicateExtras(
      groupDupes(
        tabs.map((x) => mapTab(x, base)),
        base,
      ),
    );
  } else candidates = duplicateExtras(duplicateGroups.peek());
  const n = await attempt(() =>
    send("tabs.closeDuplicates", all || w === null ? {} : { windowId: w }),
  );
  if (n === undefined) return;
  const closed = n > 0 ? await gone(candidates, all || w === null ? undefined : w) : [];
  const targets = targetsNow(closed);
  showToast({
    message: plural(n, "closedDupesOne", "closedDupesMany"),
    duration: closed.length > 0 ? 8000 : 4000,
    ...(closed.length > 0
      ? { action: { label: t("undo"), run: () => void reopenAsPlaceholders(targets) } }
      : {}),
  });
}

/** "Suspend others": the toast offers to turn auto-suspend on when it is off. */
export async function suspendOthers(): Promise<void> {
  const w = store.windowId.peek();
  if (w === null) return;
  const n = await attempt(() => send("tabs.suspendOthers", { windowId: w }));
  if (n === undefined) return;
  const msg = plural(n, "suspendedOne", "suspendedMany");
  if (store.settings.peek().suspend.enabled) return showToast({ message: msg });
  showToast({
    message: `${msg} · ${t("autoSuspendOff")}`,
    duration: 8000,
    action: { label: t("turnOn"), run: () => openExtPage("/options.html#suspension") },
  });
}

export async function suspendTab(tabId: number): Promise<void> {
  await attempt(() => send("tabs.suspend", { tabId }));
}

/**
 * Parks a live tab into the workspace's saved links (row button, `p`, drop on Saved links). A tab
 * whose URL is already saved there only shows "Already saved" (same check as the Add form).
 */
export async function parkTab(tabId: number, workspaceId: string): Promise<void> {
  const tab = store.liveTabs.peek().find((x) => x.id === tabId);
  if (tab && isSavedLink(workspaceId, tab.url)) {
    showToast({ message: t("alreadySaved") });
    return;
  }
  const link = await attempt(() => send("tabs.park", { tabId, workspaceId }));
  if (link) showToast({ message: t("parked", link.title || link.url) });
}

/** True when a whitelist entry covers `host` (equal or a parent domain). */
const covers = (entry: string, host: string) => host === entry || host.endsWith(`.${entry}`);

/**
 * The whitelist after toggling `host`: adds it (normalized, deduped) when no entry covers it,
 * otherwise removes every entry that covers it (`removed`, as stored). Pure.
 */
export function toggleWhitelist(
  list: readonly string[],
  host: string,
): { whitelist: string[]; added: boolean; removed: string[] } {
  const h = normalizeWhitelistEntry(host) ?? host;
  const norm = list.map((e) => normalizeWhitelistEntry(e));
  const hit = (i: number) => {
    const e = norm[i];
    return e !== null && e !== undefined && covers(e, h);
  };
  if (norm.some((_e, i) => hit(i))) {
    return {
      whitelist: list.filter((_e, i) => !hit(i)),
      added: false,
      removed: list.filter((_e, i) => hit(i)),
    };
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of [...norm, h]) {
    if (e === null || seen.has(e)) continue;
    seen.add(e);
    out.push(e);
  }
  return { whitelist: out, added: true, removed: [] };
}

/**
 * "Never suspend this site" / "Allow suspending this site" (settings.update with expectedRev).
 * Adding past LIMITS.whitelistHosts sends nothing and says so; removing names the entries removed
 * (a parent-domain entry also stops covering its other subdomains).
 */
export async function toggleSiteWhitelist(host: string): Promise<void> {
  const cur = store.settings.peek();
  const next = toggleWhitelist(cur.suspend.whitelist, host);
  if (next.added && next.whitelist.length > LIMITS.whitelistHosts) {
    showToast({
      message: t("neverSuspendFull", LIMITS.whitelistHosts),
      duration: 8000,
      action: { label: t("openSettings"), run: () => openExtPage("/options.html#suspension") },
    });
    return;
  }
  const res = await attempt(() =>
    send("settings.update", {
      patch: { suspend: { ...cur.suspend, whitelist: next.whitelist } },
      expectedRev: cur.rev,
    }),
  );
  if (!res) return;
  showToast({
    message: next.added
      ? t("neverSuspendDone", host)
      : t("allowSuspendRemoved", next.removed.join(", ")),
  });
}

/** Whether `url` is already a saved link of the workspace (normalized match). */
export function isSavedLink(workspaceId: string, url: string): boolean {
  const want = normalizeForMatch(url);
  return (store.metas.peek()[workspaceId]?.resources ?? []).some(
    (l) => normalizeForMatch(l.url) === want,
  );
}
