// Framework-free, external script (no inline JS; see CSP). Params live in the hash:
// u = original url, t = title, w = workspace id, s = suspended-at timestamp.
const params = new URLSearchParams(location.hash.slice(1));
const url = params.get("u") ?? "";
const title = params.get("t") ?? url;

document.title = title || "Tabitat suspended";
const app = document.getElementById("app");
if (app) {
  const h1 = document.createElement("h1");
  h1.textContent = title || "Suspended tab";
  app.append(h1);
}

// TODO: navigation (restore `url` on user activation) is intentionally not implemented yet.
