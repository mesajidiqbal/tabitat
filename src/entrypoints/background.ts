import { openOnboardingIfNew } from "@/background/onboarding";
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
      // Init runs once per worker life; a failed init is re-attempted here (and by the next
      // alarm or message).
      void services.init().catch((e) => console.error("[tabitat] init retry failed", e));
    });
    chrome.runtime.onInstalled.addListener((details) => {
      console.log("[tabitat] installed", details.reason);
      // First install only (never on update/reload): the welcome tour, once init resolved.
      void openOnboardingIfNew(services, details.reason, (path) =>
        chrome.tabs.create({ url: chrome.runtime.getURL(path) }),
      ).catch((e) => console.error("[tabitat] opening the welcome tour failed", e));
    });
    void services.init().catch((e) => console.error("[tabitat] init failed", e));
  },
});
