/**
 * URL policy and placeholder (suspended.html) helpers. Pure; see ADR-002 and ARCHITECTURE §10.
 */
import type { PlaceholderParams, RestoreMode } from "./types";

/** Schemes restored lazily through the placeholder page. */
export const PLACEHOLDER_SCHEMES: readonly string[] = ["http:", "https:", "file:", "ftp:"];
/**
 * Every browser-internal scheme we accept in stored data (data may come from another browser via
 * import). Which of them can actually be *created* depends on the running browser: see
 * DEFAULT_DIRECT_SCHEMES / ClassifyOptions.directSchemes.
 */
export const DIRECT_SCHEMES: readonly string[] = [
  "chrome:",
  "edge:",
  "brave:",
  "about:",
  "vivaldi:",
  "opera:",
];
/**
 * Internal schemes the running browser can open directly. Chrome (spike S13): creating an
 * edge:// or brave:// tab yields an empty tab, so only chrome: and about: by default.
 */
export const DEFAULT_DIRECT_SCHEMES: readonly string[] = ["chrome:", "about:"];

export interface ClassifyOptions {
  /** Internal schemes created directly ("edge:" or "edge"); others classify as "skip". */
  directSchemes?: readonly string[];
}

/** Schemes that must never be stored or imported. */
export const DANGEROUS_SCHEMES: readonly string[] = ["javascript:", "data:", "vbscript:"];

function parseUrl(url: string): URL | null {
  if (typeof url !== "string" || url.trim() === "") return null;
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/** Lower-cased scheme including the trailing colon (e.g. "https:"), or null if unparseable. */
export function schemeOf(url: string): string | null {
  return parseUrl(url)?.protocol.toLowerCase() ?? null;
}

const normalizeScheme = (s: string) => {
  const l = s.trim().toLowerCase();
  return l.endsWith(":") ? l : `${l}:`;
};

/**
 * How a saved URL is restored in the running browser: "placeholder" (http/https/file/ftp),
 * "direct" (an internal scheme listed in `opts.directSchemes`, default chrome:/about:) or "skip"
 * (everything else, including other browsers' internal schemes such as edge: on Chrome).
 */
export function classifyUrl(url: string, opts: ClassifyOptions = {}): RestoreMode {
  const scheme = schemeOf(url);
  if (scheme === null) return "skip";
  if (PLACEHOLDER_SCHEMES.includes(scheme)) return "placeholder";
  const direct = opts.directSchemes?.map(normalizeScheme) ?? DEFAULT_DIRECT_SCHEMES;
  if (DIRECT_SCHEMES.includes(scheme) && direct.includes(scheme)) return "direct";
  return "skip";
}

/**
 * URL policy for stored tabs/links (schemas): http(s)/file/ftp or ANY known browser-internal
 * scheme, independent of the running browser.
 */
export function isRestorableUrl(url: string): boolean {
  return classifyUrl(url, { directSchemes: DIRECT_SCHEMES }) !== "skip";
}

/** True for javascript:/data:/vbscript: (checked on the raw string, so whitespace/case tricks are caught). */
export function isDangerousUrl(url: string): boolean {
  // Browsers strip leading C0 controls/spaces and tabs/newlines inside the scheme.
  let raw = "";
  for (const ch of url) if (ch.charCodeAt(0) > 0x20) raw += ch.toLowerCase();
  return DANGEROUS_SCHEMES.some((s) => raw.startsWith(s));
}

function stripHash(url: string): string {
  const i = url.indexOf("#");
  return i === -1 ? url : url.slice(0, i);
}

/** `${base}#u=…&t=…&w=…&s=…` with URLSearchParams encoding (safe for `#`, `&`, unicode, spaces). */
export function buildPlaceholderUrl(base: string, p: PlaceholderParams): string {
  const hash = new URLSearchParams({ u: p.u, t: p.t, w: p.w, s: p.s }).toString();
  return `${stripHash(base)}#${hash}`;
}

/**
 * Parses one of our placeholder URLs. Returns null when `url` is not `${base}#…`, has no `u`,
 * or when `u` is not a placeholder-restorable URL (http/https/file/ftp).
 */
export function parsePlaceholderUrl(url: string, base: string): PlaceholderParams | null {
  if (typeof url !== "string" || !base) return null;
  const hashAt = url.indexOf("#");
  if (hashAt === -1) return null;
  if (url.slice(0, hashAt) !== stripHash(base)) return null;
  const params = new URLSearchParams(url.slice(hashAt + 1));
  const u = params.get("u");
  if (u === null || classifyUrl(u) !== "placeholder") return null;
  return { u, t: params.get("t") ?? "", w: params.get("w") ?? "", s: params.get("s") ?? "" };
}

export function isPlaceholderUrl(url: string, base: string): boolean {
  return parsePlaceholderUrl(url, base) !== null;
}

/** The real target URL for placeholders; the input otherwise. */
export function unwrapUrl(url: string, base: string): string {
  return parsePlaceholderUrl(url, base)?.u ?? url;
}

/** Lower-cased hostname, or null when the URL has none / is invalid. */
export function hostOf(url: string): string | null {
  const host = parseUrl(url)?.hostname.toLowerCase();
  return host ? host : null;
}

/** Same host, ignoring a leading "www.". False when either URL has no host. */
export function isSameSite(a: string, b: string): boolean {
  const ha = hostOf(a);
  const hb = hostOf(b);
  if (ha === null || hb === null) return false;
  return ha.replace(/^www\./, "") === hb.replace(/^www\./, "");
}

/** Key for duplicate detection / similarity: drops the hash and trailing slashes. */
export function normalizeForMatch(url: string): string {
  const u = parseUrl(url);
  if (u === null) return stripHash(url).replace(/\/+$/, "");
  u.hash = "";
  if (u.pathname.length > 1 && u.pathname.endsWith("/")) {
    u.pathname = u.pathname.replace(/\/+$/, "") || "/";
  }
  let s = u.href;
  if (!u.search && s.endsWith("/")) s = s.replace(/\/+$/, "");
  return s;
}
