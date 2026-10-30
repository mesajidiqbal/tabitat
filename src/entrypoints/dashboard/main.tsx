import { render } from "preact";
import { initStore } from "@/ui/store";
import { App } from "./App";

// Same as the popup: paint once the first storage read is in (the first frame already shows the
// layout and the user's widgets in order); never wait longer than 150 ms.
const root = document.getElementById("app");
void Promise.race([initStore(), new Promise((r) => setTimeout(r, 150))]).then(() => {
  if (root) render(<App />, root);
  performance.mark("tabitat:rendered");
  requestAnimationFrame(() => setTimeout(() => performance.mark("tabitat:painted")));
});
