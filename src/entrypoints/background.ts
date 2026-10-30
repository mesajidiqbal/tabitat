import { createServices } from "@/background/services";
import { attachRpcServer } from "@/messaging/server";
import { detectDirectSchemes } from "@/platform/brand";
import { createChromeBgPorts } from "@/platform/chrome";

export default defineBackground({
  type: "module",
  main() {
    const ports = createChromeBgPorts();
    const flavor = chrome.runtime.getManifest().chrome_url_overrides?.newtab ? "newtab" : "default";
    const services = createServices(ports, { flavor, directSchemes: detectDirectSchemes() });
    // Every listener is registered synchronously at top level (MV3); handlers await ready().
    services.start();
    attachRpcServer(services.router);
    chrome.runtime.onStartup.addListener(() => {
      // Waking the worker is enough: init below runs once per worker life.
    });
    chrome.runtime.onInstalled.addListener((details) => {
      console.log("[tabitat] installed", details.reason);
    });
    void services.init().catch((e) => console.error("[tabitat] init failed", e));
  },
});
