/**
 * User actions shared by popup and side panel. Mutations go through `send()` (ADR-003);
 * focusing/activating/creating tabs uses chrome.tabs/windows directly (no storage writes).
 */
import { signal } from "@preact/signals";
import { normalizeForMatch, unwrapUrl } from "@/core/ops/url";
import { plural, t } from "@/i18n";
import { send } from "@/messaging/client";
import { RpcError } from "@/messaging/errors";
import { showToast } from "./components/Toast";
import { activeWorkspaceId, busy, owners, store } from "./store";

/** Inline error line (busy / conflict / limit / …) shown under the workspaces header. */
export const uiError = signal<string | null>(null);
/** The inline new-workspace form is open. */
export const newWorkspaceOpen = signal(false);

export function errorText(e: unknown): string {
  if (e instanceof RpcError) {
    switch (e.code) {
      case "busy":
        return t("errBusy");
      case "conflict":
        return t("errConflict");
      case "limit":
        return t("errLimit", e.message);
      case "not_found":
        return t("errNotFound");
      case "invalid":
        return t("errInvalid", e.message);
      default:
        return t("errInternal", e.message);
    }
  }
  return t("errInternal", e instanceof Error ? e.message : String(e));
}

/** Runs an RPC action; a failure becomes the inline error line and resolves undefined. */
export async function attempt<T>(fn: () => Promise<T>): Promise<T | undefined> {
  uiError.value = null;
  try {
    return await fn();
  } catch (e) {
    uiError.value = errorText(e);
    return undefined;
  }
}

export function isPopup(): boolean {
  try {
    return chrome.extension.getViews({ type: "popup" }).includes(window);
  } catch {
    return false;
  }
}

export function closePopup(): void {
  if (isPopup()) window.close();
}

/** Opens the side panel. Must stay synchronous: sidePanel.open needs the click's user gesture. */
export function openSidePanel(): void {
  const w = store.windowId.peek();
  if (w === null) return;
  chrome.sidePanel.open({ windowId: w }).then(closePopup, (e: unknown) => {
    uiError.value = errorText(e);
  });
}

export function openExtPage(path: string): void {
  void chrome.tabs.create({ url: chrome.runtime.getURL(path) }).then(closePopup);
}

export async function activateTab(tabId: number, windowId: number): Promise<void> {
  await chrome.tabs.update(tabId, { active: true });
  if (windowId !== store.windowId.peek()) await chrome.windows.update(windowId, { focused: true });
  closePopup();
}

export async function openUrl(url: string): Promise<void> {
  const w = store.windowId.peek();
  await chrome.tabs.create(w === null ? { url } : { url, windowId: w });
  closePopup();
}

/** Activates the first tab of `windowId` whose (unwrapped) URL matches `url`. */
export async function activateByUrl(windowId: number, url: string): Promise<boolean> {
  const base = chrome.runtime.getURL("/suspended.html");
  const want = normalizeForMatch(url);
  const tabs = await chrome.tabs.query({ windowId });
  const hit = tabs.find(
    (x) => normalizeForMatch(unwrapUrl(x.url || x.pendingUrl || "", base)) === want,
  );
  if (hit?.id === undefined) return false;
  await activateTab(hit.id, windowId);
  return true;
}

/**
 * Switches the current window to `workspaceId`. A workspace open in another window is focused
 * there instead (the worker would answer `conflict`). Resolves true when it is now shown.
 */
export async function switchTo(workspaceId: string): Promise<boolean> {
  const w = store.windowId.peek();
  if (w === null || busy.peek()) return false;
  if (activeWorkspaceId.peek() === workspaceId) return true;
  const owner = owners.peek()[workspaceId];
  if (owner !== undefined && owner !== w) {
    await chrome.windows.update(owner, { focused: true });
    closePopup();
    return true;
  }
  store.pendingSwitch.value = { to: workspaceId };
  const res = await attempt(() => send("workspace.switch", { windowId: w, workspaceId }));
  store.pendingSwitch.value = null;
  if (res && res.skipped.length > 0) {
    showToast({ message: plural(res.skipped.length, "skippedOne", "skippedMany") });
  }
  return res !== undefined;
}

/** Undo toast for 8 s (trash.restore). */
export function undoToast(message: string, trashId: string): void {
  showToast({
    message,
    duration: 8000,
    action: {
      label: t("undo"),
      run: () => void attempt(() => send("trash.restore", { trashId })),
    },
  });
}

export async function deleteWorkspace(id: string, name: string): Promise<void> {
  const res = await attempt(() => send("workspace.delete", { id }));
  if (res) undoToast(t("deletedWorkspace", name), res.trashId);
}

export async function removeLink(workspaceId: string, linkId: string, title: string) {
  const res = await attempt(() => send("link.remove", { workspaceId, linkId }));
  if (res) undoToast(t("removedLink", title), res.trashId);
}
