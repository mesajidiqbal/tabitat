import { render } from "preact";
import { Keys } from "@/core/model/types";
import { t } from "@/i18n";
import { applyTheme } from "@/ui/theme";
import { App, themeOf } from "./App";

// The HTML <title> is the brand name; the localized one replaces it at runtime.
document.title = t("onbTitle");

// Paint from storage like the other pages: apply the saved theme before the first frame (no
// light/dark flash), but never wait longer than 150 ms for the read.
const root = document.getElementById("app");
const themed = chrome.storage.local.get(Keys.settings).then(
  (res) => applyTheme(themeOf(res[Keys.settings])),
  () => undefined,
);
void Promise.race([themed, new Promise((r) => setTimeout(r, 150))]).then(() => {
  if (root) render(<App />, root);
  performance.mark("tabitat:rendered");
  requestAnimationFrame(() => setTimeout(() => performance.mark("tabitat:painted")));
});
