/** Small display helpers (time, hosts, favicons). */
import { faviconPageUrl } from "@/core/ops/url";

let rtf: Intl.RelativeTimeFormat | null = null;
const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
];

/** "5 min. ago", "yesterday", "now" (locale-aware, narrow). */
export function relTime(ts: number, now = Date.now()): string {
  rtf ??= new Intl.RelativeTimeFormat(undefined, { numeric: "auto", style: "narrow" });
  const diff = ts - now;
  for (const [unit, ms] of UNITS) {
    if (Math.abs(diff) >= ms) return rtf.format(Math.round(diff / ms), unit);
  }
  return rtf.format(0, "second");
}

export function absTime(ts: number): string {
  return new Date(ts).toLocaleString();
}

/** Host for display ("example.com"), or the URL itself for hostless schemes. */
export function hostLabel(url: string): string {
  try {
    const u = new URL(url);
    if (u.hostname) return u.hostname.replace(/^www\./, "");
    return u.protocol === "file:" ? u.pathname.split("/").pop() || url : url;
  } catch {
    return url;
  }
}

/**
 * Favicon through the extension's local favicon endpoint (permission "favicon"; no network).
 * Only origin + path is passed (faviconPageUrl). Empty for schemes without one.
 */
export function faviconSrc(url: string): string {
  const page = faviconPageUrl(url);
  if (!page) return "";
  return `${chrome.runtime.getURL("/_favicon/")}?pageUrl=${encodeURIComponent(page)}&size=16`;
}

/** Triggers a browser download of `data` as pretty JSON (blob URL; no network). */
export function downloadJson(filename: string, data: unknown): void {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
