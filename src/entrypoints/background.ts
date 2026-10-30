import { markReady } from "@/background/ready";

export default defineBackground({
  type: "module",
  main() {
    chrome.runtime.onInstalled.addListener((details) => {
      console.log("[tabitat] installed", details.reason);
    });
    markReady();
  },
});
