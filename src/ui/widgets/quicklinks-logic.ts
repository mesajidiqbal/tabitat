/** Pure quick-link edits (docs/PHASE4.md §4 Quick links): canonical order 0..n-1. */
import { isValidId } from "@/core/model/id";
import type { QuickLink } from "@/core/model/types";
import { LIMITS } from "@/core/model/types";
import { isRestorableUrl } from "@/core/ops/url";

export const QUICKLINK_CAP = LIMITS.quickLinks;

const renumber = (items: QuickLink[]): QuickLink[] =>
  items.map((x, i) => (x.order === i ? x : { ...x, order: i }));

/** By `order`, dropping items the worker would reject (bad id or URL scheme). */
export function sortLinks(items: readonly QuickLink[]): QuickLink[] {
  return [...items]
    .filter((x) => isValidId(x.id) && isRestorableUrl(x.url))
    .sort((a, b) => a.order - b.order);
}

/**
 * The URL a user typed, normalised: "example.com" -> "https://example.com/". Null when it is not
 * a URL the worker accepts (javascript:, data:, garbage).
 */
export function normalizeLinkUrl(input: string): string | null {
  const raw = input.trim();
  if (raw === "" || /\s/.test(raw)) return null;
  const withScheme =
    /^[a-z][a-z0-9+.-]*:/i.test(raw) && !/^[^:]+:\d/.test(raw) ? raw : `https://${raw}`;
  try {
    const u = new URL(withScheme);
    if ((u.protocol === "http:" || u.protocol === "https:") && !u.hostname) return null;
    return isRestorableUrl(u.href) ? u.href : null;
  } catch {
    return null;
  }
}

/** Title shown when the user typed none: the host without "www.". */
export function defaultLinkTitle(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "") || url;
  } catch {
    return url;
  }
}

export function addLink(items: readonly QuickLink[], link: Omit<QuickLink, "order">): QuickLink[] {
  const list = sortLinks(items);
  if (list.length >= QUICKLINK_CAP) return list;
  return renumber([...list, { ...link, order: list.length }]);
}

export function updateLink(
  items: readonly QuickLink[],
  id: string,
  patch: Partial<Pick<QuickLink, "url" | "title">>,
): QuickLink[] {
  return renumber(sortLinks(items).map((x) => (x.id === id ? { ...x, ...patch } : x)));
}

export function removeLink(items: readonly QuickLink[], id: string): QuickLink[] {
  return renumber(sortLinks(items).filter((x) => x.id !== id));
}

/** Re-adds a removed link at `index` (undo); no-op when its id is back already or at the cap. */
export function reinsertLink(items: readonly QuickLink[], link: QuickLink, index: number) {
  const list = sortLinks(items);
  if (list.some((x) => x.id === link.id) || list.length >= QUICKLINK_CAP) return list;
  list.splice(Math.max(0, Math.min(list.length, index)), 0, link);
  return renumber(list);
}

export function moveLink(items: readonly QuickLink[], id: string, delta: number): QuickLink[] {
  const list = sortLinks(items);
  const from = list.findIndex((x) => x.id === id);
  if (from < 0) return renumber(list);
  const to = Math.max(0, Math.min(list.length - 1, from + delta));
  const [item] = list.splice(from, 1);
  if (item) list.splice(to, 0, item);
  return renumber(list);
}

export function moveLinkTo(items: readonly QuickLink[], id: string, targetId: string) {
  const list = sortLinks(items);
  const from = list.findIndex((x) => x.id === id);
  const to = list.findIndex((x) => x.id === targetId);
  if (from < 0 || to < 0) return renumber(list);
  return moveLink(list, id, to - from);
}
