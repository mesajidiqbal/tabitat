import { render } from "preact";
import { t } from "@/i18n";
import { App } from "./App";

// The HTML <title> is the brand name; the localized one replaces it at runtime.
document.title = t("optTitle");
const root = document.getElementById("app");
if (root) render(<App />, root);
