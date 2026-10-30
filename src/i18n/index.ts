/**
 * UI strings. `t(key, subs?)` wraps chrome.i18n.getMessage. In dev (`wxt` serve) and unit tests
 * it falls back to the bundled en messages (public/_locales/en/messages.json) when the API is
 * missing or returns "" (unknown key); production builds compile the fallback out
 * (`__TABITAT_I18N_FALLBACK__` is false, so the JSON is not bundled) and return the key.
 * Keys are typed from the en file, so a missing key fails typecheck.
 */
import en from "../../public/_locales/en/messages.json";

export type MsgKey = keyof typeof en;
type Sub = string | number;

interface Entry {
  message: string;
  placeholders?: Record<string, { content: string }>;
}

/** chrome.i18n semantics: $NAME$ -> placeholder content, $1..$9 -> substitutions, $$ -> $. */
export function formatMessage(entry: Entry, subs: readonly string[]): string {
  const named = entry.message.replace(/\$([A-Za-z0-9_@]+)\$/g, (m, name: string) => {
    const ph = entry.placeholders?.[name.toLowerCase()] ?? entry.placeholders?.[name];
    return ph ? ph.content : m;
  });
  return named.replace(/\$(\$|[1-9])/g, (_m, d: string) =>
    d === "$" ? "$" : (subs[Number(d) - 1] ?? ""),
  );
}

export function t(key: MsgKey, subs?: Sub | readonly Sub[]): string {
  const list = subs === undefined ? [] : (Array.isArray(subs) ? subs : [subs]).map(String);
  try {
    const msg = globalThis.chrome?.i18n?.getMessage(key, list);
    if (msg) return msg;
  } catch {
    // not in an extension context
  }
  if (__TABITAT_I18N_FALLBACK__) {
    const entry = (en as Record<string, Entry>)[key];
    if (entry) return formatMessage(entry, list);
  }
  return key;
}

/** `one` when n === 1, else `many`; both receive n as $1. */
export function plural(n: number, one: MsgKey, many: MsgKey): string {
  return t(n === 1 ? one : many, n);
}
