/**
 * How a browser tab's URL fields map onto LiveTab.url (shared by chrome.ts and the fake so the
 * fake cannot diverge). Chrome keeps the committed URL in `url` and an in-flight navigation's
 * target in `pendingUrl`; a freshly created tab has `url: ""` until the navigation commits.
 * While loading with a pending URL, the pending URL is the tab's content-to-be: prefer it.
 */
export function liveTabUrl(tab: { url?: string; pendingUrl?: string; status?: string }): string {
  const pending = tab.pendingUrl ?? "";
  if (tab.status === "loading" && pending !== "") return pending;
  return tab.url || pending || "";
}
