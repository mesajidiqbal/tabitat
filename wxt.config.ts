import preact from "@preact/preset-vite";
import { defineConfig } from "wxt";

const isNewTab = process.env.TABITAT_FLAVOR === "newtab";

const PROD_CSP =
  "script-src 'self'; object-src 'none'; connect-src 'none'; img-src 'self' data: chrome-extension:; style-src 'self'";
// Dev only: connect-src is omitted so the HMR websocket works, and style-src allows the
// inline <style> tags Vite injects. WXT itself appends the dev-server origin to script-src
// (and adds a host permission) when running `wxt` in serve mode.
const DEV_CSP =
  "script-src 'self'; object-src 'none'; img-src 'self' data: chrome-extension:; style-src 'self' 'unsafe-inline'";

export default defineConfig({
  srcDir: "src",
  outDir: isNewTab ? ".output-newtab" : ".output",
  modules: [],
  vite: () => ({
    plugins: [preact()],
  }),
  manifest: ({ command }) => ({
    name: isNewTab ? "Tabitat New Tab" : "Tabitat",
    description: "Workspaces for your tabs. Local-only, no network.",
    minimum_chrome_version: "121",
    default_locale: "en",
    permissions: [
      "tabs",
      "tabGroups",
      "storage",
      "unlimitedStorage",
      "sidePanel",
      "alarms",
      "sessions",
      "favicon",
      "notifications",
      "search",
    ],
    optional_permissions: ["bookmarks"],
    incognito: "not_allowed",
    action: { default_title: "Tabitat" },
    side_panel: { default_path: "sidepanel.html" },
    options_ui: { page: "options.html", open_in_tab: true },
    ...(isNewTab ? { chrome_url_overrides: { newtab: "dashboard.html" } } : {}),
    commands: {
      "open-search": {
        description: "Search tabs and workspaces",
        suggested_key: { default: "Ctrl+Shift+K", mac: "Command+Shift+K" },
      },
      "next-workspace": {
        description: "Switch to next workspace",
        suggested_key: { default: "Ctrl+Shift+Period", mac: "Command+Shift+Period" },
      },
      "prev-workspace": {
        description: "Switch to previous workspace",
        suggested_key: { default: "Ctrl+Shift+Comma", mac: "Command+Shift+Comma" },
      },
      "suspend-other-tabs": { description: "Suspend all other tabs in this window" },
      "toggle-side-panel": { description: "Open the Tabitat side panel" },
    },
    content_security_policy: {
      extension_pages: command === "serve" ? DEV_CSP : PROD_CSP,
    },
  }),
});
