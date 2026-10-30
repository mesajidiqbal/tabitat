import { mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrowserContext, Worker } from "@playwright/test";
import { BRAVE, extensionPath, launchExtension } from "../support/extension";

export { BRAVE };
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

export function preparedExtension(): string {
  return extensionPath;
}

export async function launch(
  userDataDir: string = freshDir(),
  extraArgs: string[] = [],
): Promise<Launched> {
  const l = await launchExtension({
    browser: useBrave ? "brave" : "chrome",
    headed,
    userDataDir,
    extraArgs,
  });
  return { context: l.context, worker: l.worker, extId: l.extensionId, userDataDir };
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
