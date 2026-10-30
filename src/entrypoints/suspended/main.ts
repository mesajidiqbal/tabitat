// Framework-free, external script (no inline JS; see CSP, ADR-002). Strings come from
// chrome.i18n directly (no shared UI bundle on this page).
import { faviconPageUrl } from "@/core/ops/url";
import { applyTheme } from "@/ui/theme";

const msg = (key: string): string => {
  try {
    return chrome.i18n.getMessage(key) || "";
  } catch {
    return "";
  }
};

// Hash params: u = target url, t = title, w = workspace id, s = saved tab id.
const params = new URLSearchParams(location.hash.slice(1));
const target = params.get("u") ?? "";
const title = params.get("t") || target || msg("placeholderUntitled");

let parsed: URL | null = null;
try {
  parsed = new URL(target);
} catch {
  parsed = null;
}
const allowed = parsed !== null && ["http:", "https:", "file:", "ftp:"].includes(parsed.protocol);

// Explicit light / dark from settings (read only); "system" follows prefers-color-scheme.
void chrome.storage?.local
  .get("settings")
  .then((r) => {
    const theme = (r.settings as { theme?: unknown } | undefined)?.theme;
    if (theme === "light" || theme === "dark" || theme === "system") applyTheme(theme);
  })
  .catch(() => undefined);

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string) => {
  const node = document.createElement(tag);
  node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
};

document.title = title;
const app = document.getElementById("app");
if (app) {
  const card = el("main", "card");
  const icon = el("img", "icon");
  icon.width = 32;
  icon.height = 32;
  icon.alt = "";
  // origin + path only: query tokens and fragments never reach the favicon cache
  icon.src = `${chrome.runtime.getURL("/_favicon/")}?pageUrl=${encodeURIComponent(faviconPageUrl(target))}&size=32`;
  const host = el("p", "host", parsed?.hostname || target);
  const hint = el("p", "hint", msg(allowed ? "placeholderLoad" : "placeholderCannotLoad"));
  card.append(icon, el("h1", "title", title), host, hint);
  app.append(card, el("footer", "footer", msg("placeholderFooter")));
}

let navigated = false;
function load(): void {
  if (!allowed || navigated) return;
  navigated = true;
  location.replace(target);
}
if (document.visibilityState === "visible") load();
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") load();
});
document.addEventListener("click", load);
document.addEventListener("keydown", load);
