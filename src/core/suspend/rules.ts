/**
 * Suspension (tabs.discard) eligibility and duplicate detection (ARCHITECTURE §5.7). Pure.
 */
import type { Settings } from "../model/types";
import type { LiveTab } from "../ops/types";
import { hostOf, isPlaceholderUrl, normalizeForMatch, schemeOf, unwrapUrl } from "../ops/url";

const MINUTE = 60_000;

/** Normalizes a whitelist entry ("Example.com", "*.example.com", "https://example.com/x") to a host. */
export function normalizeWhitelistEntry(entry: string): string | null {
  let e = entry.trim().toLowerCase();
  if (e === "") return null;
  if (e.includes("://")) e = hostOf(e) ?? "";
  e = e
    .replace(/^\*\./, "")
    .replace(/^\./, "")
    .replace(/[/:].*$/, "");
  return e === "" ? null : e;
}

/** True when `host` equals a whitelist entry or is a subdomain of one. */
export function isWhitelisted(host: string, whitelist: readonly string[]): boolean {
  const h = host.toLowerCase();
  return whitelist.some((raw) => {
    const e = normalizeWhitelistEntry(raw);
    return e !== null && (h === e || h.endsWith(`.${e}`));
  });
}

/**
 * Whether the suspender may discard `tab`. Does not look at `settings.enabled` (the caller gates
 * the alarm). Requires lastAccessed to be known and at least `afterMinutes` old.
 */
export function eligibleForDiscard(
  tab: LiveTab,
  settings: Settings["suspend"],
  now: number,
  opts: { placeholderBase: string },
): boolean {
  if (tab.active || tab.pinned || tab.audible || tab.discarded) return false;
  const scheme = schemeOf(tab.url);
  if (scheme !== "http:" && scheme !== "https:") return false;
  if (isPlaceholderUrl(tab.url, opts.placeholderBase)) return false;
  if (tab.lastAccessed === undefined) return false;
  if (now - tab.lastAccessed < settings.afterMinutes * MINUTE) return false;
  const host = hostOf(tab.url);
  return host !== null && !isWhitelisted(host, settings.whitelist);
}

/**
 * Groups (size >= 2) of tab ids that share a normalized, unwrapped URL. Pinned tabs and tabs with
 * an empty URL are ignored. Within a group the tab to keep comes first: active, then most recently
 * accessed, then lowest index. Groups are ordered by first appearance in `tabs`.
 */
export function findDuplicates(
  tabs: readonly LiveTab[],
  opts: { placeholderBase?: string } = {},
): number[][] {
  const base = opts.placeholderBase ?? "";
  const groups = new Map<string, LiveTab[]>();
  for (const t of tabs) {
    if (t.pinned || !t.url) continue;
    const key = normalizeForMatch(base ? unwrapUrl(t.url, base) : t.url);
    const list = groups.get(key);
    if (list) list.push(t);
    else groups.set(key, [t]);
  }
  const rank = (a: LiveTab, b: LiveTab) =>
    Number(b.active) - Number(a.active) ||
    (b.lastAccessed ?? Number.NEGATIVE_INFINITY) - (a.lastAccessed ?? Number.NEGATIVE_INFINITY) ||
    a.index - b.index;
  return [...groups.values()]
    .filter((g) => g.length > 1)
    .map((g) => [...g].sort(rank).map((t) => t.id));
}
