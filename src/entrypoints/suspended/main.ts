// Framework-free, external script (no inline JS; see CSP, ADR-002).
// Hash params: u = target url, t = title, w = workspace id, s = saved tab id.
const params = new URLSearchParams(location.hash.slice(1));
const target = params.get("u") ?? "";
const title = params.get("t") || target || "Suspended tab";

let parsed: URL | null = null;
try {
  parsed = new URL(target);
} catch {
  parsed = null;
}
const allowed = parsed !== null && ["http:", "https:", "file:", "ftp:"].includes(parsed.protocol);

document.title = title;
const app = document.getElementById("app");
if (app) {
  const icon = document.createElement("img");
  icon.width = 32;
  icon.height = 32;
  icon.alt = "";
  icon.src = `${chrome.runtime.getURL("/_favicon/")}?pageUrl=${encodeURIComponent(target)}&size=32`;
  const h1 = document.createElement("h1");
  h1.textContent = title;
  const host = document.createElement("p");
  host.textContent = parsed?.hostname || target;
  const hint = document.createElement("p");
  hint.textContent = allowed ? "Click to load" : "Cannot load this address";
  app.append(icon, h1, host, hint);
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
