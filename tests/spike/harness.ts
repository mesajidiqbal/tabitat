import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type BrowserContext, chromium, type Worker } from "@playwright/test";

export const extensionPath = resolve("./.output/chrome-mv3");
export const BRAVE = "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser";
export const useBrave = process.env.SPIKE_BROWSER === "brave";
export const headed = process.env.SPIKE_HEADED === "1";
export const browserName = useBrave ? "brave" : "chrome";

export interface Launched {
  context: BrowserContext;
  worker: Worker;
  extId: string;
  userDataDir: string;
}

export function freshDir(): string {
  return mkdtempSync(join(tmpdir(), "tabitat-spike-"));
}

/**
 * The built manifest ships `_locales/` without `default_locale`, which Chrome rejects
 * ("Localisation used, but default_locale wasn't specified"). Spike runs against a patched copy
 * so the build output stays untouched. See docs/SPIKE.md Findings.
 */
let preparedExt: string | null = null;
export function preparedExtension(): string {
  if (preparedExt) return preparedExt;
  const dir = join(mkdtempSync(join(tmpdir(), "tabitat-ext-")), "ext");
  cpSync(extensionPath, dir, { recursive: true });
  const mp = join(dir, "manifest.json");
  const m = JSON.parse(readFileSync(mp, "utf8"));
  m.default_locale ??= "en";
  writeFileSync(mp, JSON.stringify(m));
  preparedExt = dir;
  return dir;
}

export async function launch(
  userDataDir: string = freshDir(),
  extraArgs: string[] = [],
): Promise<Launched> {
  if (!existsSync(extensionPath)) throw new Error("build first: npm run build");
  const ext = preparedExtension();
  const context = await chromium.launchPersistentContext(userDataDir, {
    ...(useBrave ? { executablePath: BRAVE } : { channel: "chrome" }),
    headless: false,
    ignoreDefaultArgs: ["--disable-extensions"],
    args: [
      ...(headed ? [] : ["--headless=new"]),
      ...(useBrave ? [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`] : []),
      ...extraArgs,
    ],
  });
  if (!useBrave) {
    // Branded Chrome >= 137 ignores --load-extension; load through CDP instead.
    const browser = context.browser();
    if (!browser) throw new Error("no browser handle");
    const cdp = await browser.newBrowserCDPSession();
    await cdp.send("Extensions.loadUnpacked" as never, { path: ext } as never);
  }
  const worker =
    context.serviceWorkers().find((w) => w.url().includes("background.js")) ??
    (await context.waitForEvent("serviceworker", { timeout: 20_000 }));
  return { context, worker, extId: new URL(worker.url()).host, userDataDir };
}

/** Local HTTP target so "no network load" is measured server-side, not just in the browser. */
export async function targetServer(): Promise<{
  server: Server;
  origin: string;
  hits: string[];
  close: () => Promise<void>;
}> {
  const hits: string[] = [];
  const server = createServer((req, res) => {
    hits.push(req.url ?? "");
    res.setHeader("content-type", "text/html");
    res.end(`<!doctype html><title>Target ${req.url}</title><p>${req.url}</p>`);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    server,
    origin,
    hits,
    close: () =>
      new Promise((r) => {
        server.close(() => r());
        server.closeAllConnections();
      }),
  };
}

export function pct(xs: number[], p: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] ?? Number.NaN;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const log = (line: string) =>
  console.log(`[${browserName}${headed ? "-headed" : ""}] ${line}`);
