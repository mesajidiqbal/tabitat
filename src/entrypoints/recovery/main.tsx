import { render } from "preact";
import { initStore } from "@/ui/store";
import { App } from "./App";

const root = document.getElementById("app");
void Promise.race([initStore(), new Promise((r) => setTimeout(r, 300))]).then(() => {
  if (root) render(<App />, root);
});
