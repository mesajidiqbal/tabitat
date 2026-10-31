import preact from "@preact/preset-vite";
import { defineConfig } from "wxt";
import { REPO_URL } from "./src/ui/options/about";

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
  vite: ({ command }) => ({
    plugins: [preact()],
    // The en fallback of `t()` (src/i18n) bundles the whole messages.json into every surface:
    // keep it for the dev server, compile it out of production builds.
    define: { __TABITAT_I18N_FALLBACK__: JSON.stringify(command === "serve") },
  }),
  hooks: {
    // WXT copies the popup's <title> into action.default_title, overriding the value below;
    // the toolbar tooltip must be the localized message instead.
    "build:manifestGenerated": (_wxt, manifest) => {
      if (manifest.action) manifest.action.default_title = "__MSG_actionTitle__";
    },
  },
  manifest: ({ command }) => ({
    // Listing strings come from public/_locales/<lang>/messages.json (docs/I18N.md).
    name: isNewTab ? "__MSG_appNameNewTab__" : "__MSG_appName__",
    description: "__MSG_appDescription__",
    homepage_url: REPO_URL,
    minimum_chrome_version: "121",
    default_locale: "en",
    permissions: [
      "tabs",
      "tabGroups",
      "storage",
      "unlimitedStorage",
      "sidePanel",
      "alarms",
      "favicon",
      "notifications",
      "search",
    ],
    optional_permissions: ["bookmarks"],
    incognito: "not_allowed",
    action: { default_title: "__MSG_actionTitle__" },
    side_panel: { default_path: "sidepanel.html" },
    options_ui: { page: "options.html", open_in_tab: true },
    ...(isNewTab ? { chrome_url_overrides: { newtab: "dashboard.html" } } : {}),
    commands: {
      "open-search": {
        description: "__MSG_cmdOpenSearch__",
        suggested_key: { default: "Ctrl+Shift+K", mac: "Command+Shift+K" },
      },
      "next-workspace": {
        description: "__MSG_cmdNextWorkspace__",
        suggested_key: { default: "Ctrl+Shift+Period", mac: "Command+Shift+Period" },
      },
      "prev-workspace": {
        description: "__MSG_cmdPrevWorkspace__",
        suggested_key: { default: "Ctrl+Shift+Comma", mac: "Command+Shift+Comma" },
      },
      "suspend-other-tabs": { description: "__MSG_cmdSuspendOthers__" },
      "toggle-side-panel": { description: "__MSG_cmdToggleSidePanel__" },
    },
    content_security_policy: {
      extension_pages: command === "serve" ? DEV_CSP : PROD_CSP,
    },
  }),
});
