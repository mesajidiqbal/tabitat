/**
 * Live-tab actions of the Tabs section (PHASE3 §2, §3, §7): close with undo, close duplicates
 * with undo, suspend, park, and the per-site suspension whitelist. Closing / creating tabs uses
 * chrome.tabs directly (plain browser events the tracker auto-saves); saved state goes through
 * `send()` (ADR-003).
 */
import { normalizeForMatch } from "@/core/ops/url";
import { normalizeWhitelistEntry } from "@/core/suspend/rules";
import { plural, t } from "@/i18n";
import { send } from "@/messaging/client";
import { attempt, openExtPage } from "./actions";
import { showToast } from "./components/Toast";
import { activeWorkspaceId, duplicateGroups, placeholderBase, store } from "./store";
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

/** Recreates closed tabs as (unloaded) placeholders at the end of their windows. */
export async function reopenAsPlaceholders(tabs: readonly Reopen[]): Promise<void> {
  const base = placeholderBase();
  const ws = activeWorkspaceId.peek() ?? "";
  for (const tab of tabs) {
    const url = reopenUrl(tab, base, ws);
    if (url === null) continue;
    await chrome.tabs
      .create({ windowId: tab.windowId, url, active: false })
      .catch(() => chrome.tabs.create({ url, active: false }));
  }
}

/** Closes one tab; the toast offers Undo (reopens it as a placeholder). */
export async function closeTab(tab: UiTab): Promise<void> {
  try {
    await chrome.tabs.remove(tab.id);
  } catch {
    return; // already gone
  }
  const title = tab.title || tab.url;
  showToast({
    message: t("closedTab", title),
    duration: 8000,
    action: { label: t("undo"), run: () => void reopenAsPlaceholders([tab]) },
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
  showToast({
    message: plural(n, "closedDupesOne", "closedDupesMany"),
    duration: closed.length > 0 ? 8000 : 4000,
    ...(closed.length > 0
      ? { action: { label: t("undo"), run: () => void reopenAsPlaceholders(closed) } }
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

export async function parkTab(tabId: number, workspaceId: string): Promise<void> {
  const link = await attempt(() => send("tabs.park", { tabId, workspaceId }));
  if (link) showToast({ message: t("parked", link.title || link.url) });
}

/** True when a whitelist entry covers `host` (equal or a parent domain). */
const covers = (entry: string, host: string) => host === entry || host.endsWith(`.${entry}`);

/**
 * The whitelist after toggling `host`: adds it (normalized, deduped) when no entry covers it,
 * otherwise removes every entry that covers it. Pure.
 */
export function toggleWhitelist(
  list: readonly string[],
  host: string,
): { whitelist: string[]; added: boolean } {
  const h = normalizeWhitelistEntry(host) ?? host;
  const norm = list.map((e) => normalizeWhitelistEntry(e));
  if (norm.some((e) => e !== null && covers(e, h)))
    return { whitelist: list.filter((_e, i) => !(norm[i] && covers(norm[i], h))), added: false };
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of [...norm, h]) {
    if (e === null || seen.has(e)) continue;
    seen.add(e);
    out.push(e);
  }
  return { whitelist: out, added: true };
}

/** "Never suspend this site" / "Allow suspending this site" (settings.update with expectedRev). */
export async function toggleSiteWhitelist(host: string): Promise<void> {
  const cur = store.settings.peek();
  const next = toggleWhitelist(cur.suspend.whitelist, host);
  const res = await attempt(() =>
    send("settings.update", {
      patch: { suspend: { ...cur.suspend, whitelist: next.whitelist } },
      expectedRev: cur.rev,
    }),
  );
  if (res) showToast({ message: t(next.added ? "neverSuspendDone" : "allowSuspendDone", host) });
}

/** Whether `url` is already a saved link of the workspace (normalized match). */
export function isSavedLink(workspaceId: string, url: string): boolean {
  const want = normalizeForMatch(url);
  return (store.metas.peek()[workspaceId]?.resources ?? []).some(
    (l) => normalizeForMatch(l.url) === want,
  );
}
