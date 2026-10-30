// Raw-CDP driver: talks to Chrome without Playwright attached to page targets.
// Playwright force-enables focus/visibility emulation on every page it controls, which makes
// background tabs report document.visibilityState === "visible" and defeats the placeholder's
// "hidden until activated" behaviour. This driver only attaches to the extension service worker.
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BRAVE, preparedExtension, sleep, useBrave } from "./harness";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

interface Target {
  targetId: string;
  type: string;
  url: string;
}

export class RawChrome {
  private ws!: WebSocket;
  private proc!: ChildProcess;
  private id = 0;
  private pending = new Map<
    number,
    (v: { result?: unknown; error?: { message: string } }) => void
  >();
  private workerSession = "";
  extId = "";

  constructor(readonly userDataDir: string) {}

  async start(extra: string[] = []): Promise<void> {
    const ext = preparedExtension();
    const portFile = join(this.userDataDir, "DevToolsActivePort");
    const args = [
      `--user-data-dir=${this.userDataDir}`,
      "--remote-debugging-port=0",
      "--no-first-run",
      "--no-default-browser-check",
      "--window-size=1200,800",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      ...(useBrave ? [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`] : []),
      ...extra,
      "about:blank",
    ];
    this.proc = spawn(useBrave ? BRAVE : CHROME, args, { stdio: "ignore" });
    for (let i = 0; i < 100 && !existsSync(portFile); i++) await sleep(100);
    await sleep(300);
    const [port, path] = readFileSync(portFile, "utf8").trim().split("\n");
    this.ws = new WebSocket(`ws://127.0.0.1:${port}${path}`);
    await new Promise<void>((res, rej) => {
      this.ws.onopen = () => res();
      this.ws.onerror = () => rej(new Error("ws error"));
    });
    this.ws.onmessage = (m) => {
      const d = JSON.parse(String(m.data));
      this.pending.get(d.id)?.(d);
      this.pending.delete(d.id);
    };
    if (!useBrave) await this.send("Extensions.loadUnpacked", { path: ext });
    for (let i = 0; i < 100 && !this.workerSession; i++) {
      const { targetInfos } = (await this.send("Target.getTargets")) as { targetInfos: Target[] };
      const sw = targetInfos.find(
        (t) => t.type === "service_worker" && t.url.includes("background.js"),
      );
      if (sw) {
        this.extId = new URL(sw.url).host;
        const r = (await this.send("Target.attachToTarget", {
          targetId: sw.targetId,
          flatten: true,
        })) as { sessionId: string };
        this.workerSession = r.sessionId;
      } else await sleep(200);
    }
    if (!this.workerSession) throw new Error("service worker not found");
  }

  send(method: string, params: object = {}, sessionId?: string): Promise<unknown> {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, (d) => (d.error ? rej(new Error(d.error.message)) : res(d.result)));
      this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }

  /** Run an async JS expression inside the service worker; the expression must be JSON-serialisable. */
  async evalWorker<T>(expr: string): Promise<T> {
    const r = (await this.send(
      "Runtime.evaluate",
      { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true },
      this.workerSession,
    )) as { result: { value: T }; exceptionDetails?: { exception?: { description?: string } } };
    if (r.exceptionDetails)
      throw new Error(r.exceptionDetails.exception?.description ?? "eval error");
    return r.result.value;
  }

  async workerTargets(): Promise<number> {
    const { targetInfos } = (await this.send("Target.getTargets")) as { targetInfos: Target[] };
    return targetInfos.filter((t) => t.type === "service_worker" && t.url.includes("background.js"))
      .length;
  }

  async detachWorker(): Promise<void> {
    await this.send("Target.detachFromTarget", { sessionId: this.workerSession });
    this.workerSession = "";
  }

  /** Open an extension page as a tab and evaluate JS in it (no emulation applied). */
  async evalExtPage<T>(path: string, expr: string): Promise<T> {
    const { targetId } = (await this.send("Target.createTarget", {
      url: `chrome-extension://${this.extId}/${path}`,
    })) as { targetId: string };
    const { sessionId } = (await this.send("Target.attachToTarget", {
      targetId,
      flatten: true,
    })) as {
      sessionId: string;
    };
    await sleep(800);
    const r = (await this.send(
      "Runtime.evaluate",
      { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true },
      sessionId,
    )) as { result: { value: T } };
    return r.result.value;
  }

  async reattachWorker(): Promise<boolean> {
    const { targetInfos } = (await this.send("Target.getTargets")) as { targetInfos: Target[] };
    const sw = targetInfos.find(
      (t) => t.type === "service_worker" && t.url.includes("background.js"),
    );
    if (!sw) return false;
    const r = (await this.send("Target.attachToTarget", {
      targetId: sw.targetId,
      flatten: true,
    })) as {
      sessionId: string;
    };
    this.workerSession = r.sessionId;
    return true;
  }

  /** Force-stop the extension service worker (CDP ServiceWorker.stopWorker via a page session). */
  async killWorker(): Promise<void> {
    const { targetInfos } = (await this.send("Target.getTargets")) as { targetInfos: Target[] };
    const page = targetInfos.find((t) => t.type === "page");
    if (!page) throw new Error("no page target");
    const { sessionId } = (await this.send("Target.attachToTarget", {
      targetId: page.targetId,
      flatten: true,
    })) as { sessionId: string };
    const versions: { versionId: string; scriptURL: string; runningStatus: string }[] = [];
    const onMsg = (m: MessageEvent) => {
      const d = JSON.parse(String(m.data));
      if (d.method === "ServiceWorker.workerVersionUpdated") versions.push(...d.params.versions);
    };
    this.ws.addEventListener("message", onMsg);
    await this.send("ServiceWorker.enable", {}, sessionId);
    await sleep(800);
    this.ws.removeEventListener("message", onMsg);
    const v = versions.find(
      (x) => x.scriptURL.includes("background.js") && x.runningStatus === "running",
    );
    if (!v) throw new Error(`worker version not found: ${JSON.stringify(versions).slice(0, 300)}`);
    this.workerSession = "";
    await this.send("ServiceWorker.stopWorker", { versionId: v.versionId }, sessionId);
  }

  /** document.visibilityState of the first page target whose URL contains `needle`. */
  async pageVisibility(needle: string): Promise<string> {
    const { targetInfos } = (await this.send("Target.getTargets")) as { targetInfos: Target[] };
    const t = targetInfos.find((x) => x.type === "page" && x.url.includes(needle));
    if (!t) return "no-target";
    const { sessionId } = (await this.send("Target.attachToTarget", {
      targetId: t.targetId,
      flatten: true,
    })) as { sessionId: string };
    const r = (await this.send(
      "Runtime.evaluate",
      {
        expression: "document.visibilityState + '/focus=' + document.hasFocus()",
        returnByValue: true,
      },
      sessionId,
    )) as { result: { value: string } };
    await this.send("Target.detachFromTarget", { sessionId });
    return r.result.value;
  }

  async quit(): Promise<void> {
    try {
      await this.send("Browser.close");
    } catch {
      // closing drops the socket
    }
    await new Promise<void>((res) => {
      const t = setTimeout(() => {
        this.proc.kill("SIGKILL");
        res();
      }, 10000);
      this.proc.on("exit", () => {
        clearTimeout(t);
        res();
      });
    });
  }
}
