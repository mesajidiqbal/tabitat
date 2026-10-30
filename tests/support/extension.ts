import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type BrowserContext, chromium, type Worker } from "@playwright/test";

export const extensionPath = resolve("./.output/chrome-mv3");
export const BRAVE = "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser";

export interface LaunchOptions {
  browser?: "chrome" | "brave";
  headed?: boolean;
  userDataDir?: string;
  extraArgs?: string[];
  /** Override the extension directory (defaults to .output/chrome-mv3). */
  extensionDir?: string;
}

export interface LaunchedExtension {
  context: BrowserContext;
  extensionId: string;
  worker: Worker;
  userDataDir: string;
  close: () => Promise<void>;
}

/**
 * Launches installed Chrome (or Brave) with the built extension. Branded Chrome >= 137 ignores
 * --load-extension, so Chrome loads it via CDP Extensions.loadUnpacked (and must not be given
 * --disable-extensions-except); Brave still honours the flags. Never uses Playwright's Chromium.
 */
export async function launchExtension(opts: LaunchOptions = {}): Promise<LaunchedExtension> {
  const browser = opts.browser ?? "chrome";
  const ext = opts.extensionDir ?? extensionPath;
  if (!existsSync(ext)) throw new Error("build first: npm run build");
  const userDataDir = opts.userDataDir ?? mkdtempSync(join(tmpdir(), "tabitat-pw-"));
  const context = await chromium.launchPersistentContext(userDataDir, {
    ...(browser === "brave" ? { executablePath: BRAVE } : { channel: "chrome" }),
    headless: false,
    ignoreDefaultArgs: ["--disable-extensions"],
    args: [
      ...(opts.headed ? [] : ["--headless=new"]),
      ...(browser === "brave"
        ? [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`]
        : []),
      ...(opts.extraArgs ?? []),
    ],
  });
  if (browser === "chrome") {
    const b = context.browser();
    if (!b) throw new Error("no browser handle");
    const cdp = await b.newBrowserCDPSession();
    await cdp.send("Extensions.loadUnpacked" as never, { path: ext } as never);
  }
  const worker =
    context.serviceWorkers().find((w) => w.url().includes("background.js")) ??
    (await context.waitForEvent("serviceworker", { timeout: 20_000 }));
  return {
    context,
    worker,
    extensionId: new URL(worker.url()).host,
    userDataDir,
    close: () => context.close(),
  };
}
