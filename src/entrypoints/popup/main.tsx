import { render } from "preact";
import { initStore } from "@/ui/store";
import { App } from "./App";

// Paint once the first storage read is in (a few ms) so the first frame already shows the
// workspace list (no layout shift); never wait longer than 150 ms.
const root = document.getElementById("app");
const ready = initStore();
void Promise.race([ready, new Promise((r) => setTimeout(r, 150))]).then(() => {
  if (root) render(<App />, root);
  performance.mark("tabitat:rendered");
  requestAnimationFrame(() => setTimeout(() => performance.mark("tabitat:painted")));
});
