/** Test harness: FakeBrowser + Services, with worker restart. Not shipped (tests only). */
import type { SavedTab, WorkspaceMeta, WorkspaceTabs } from "../../core/model/types";
import { Keys } from "../../core/model/types";
import { parsePlaceholderUrl } from "../../core/ops/url";
import type { CommandIn, CommandOut, CommandType, Envelope } from "../../messaging/commands";
import { FakeBrowser, type TabInit } from "../../platform/fake";
import type { Logger } from "../repository";
import { createServices, type ServiceOptions, type Services } from "../services";

export interface TestLogger extends Logger {
  warnings: unknown[][];
  errors: unknown[][];
}

export function testLogger(): TestLogger {
  const warnings: unknown[][] = [];
  const errors: unknown[][] = [];
  return {
    warnings,
    errors,
    warn: (...a: unknown[]) => {
      warnings.push(a);
    },
    error: (...a: unknown[]) => {
      errors.push(a);
    },
  };
}

/** Lets pending promise chains (and fake events' async handlers) run. */
export async function settle(rounds = 5): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise<void>((r) => setImmediate(r));
}

export interface Harness {
  fake: FakeBrowser;
  svc: Services;
  log: TestLogger;
  opts: ServiceOptions;
  /** Kills the worker and builds + inits fresh services (storage and tabs persist). */
  restart(opts?: { browser?: boolean; services?: ServiceOptions }): Promise<Services>;
  rpc<T extends CommandType>(
    type: T,
    payload: CommandIn<T>,
    requestId?: string,
  ): Promise<Envelope<CommandOut<T>>>;
  ok<T extends CommandType>(type: T, payload: CommandIn<T>): Promise<CommandOut<T>>;
  placeholderBase: string;
}

let reqSeq = 0;

export async function setup(
  init: {
    windows?: Array<Array<string | TabInit>>;
    services?: ServiceOptions;
    before?: (fake: FakeBrowser) => void;
    skipInit?: boolean;
  } = {},
): Promise<Harness> {
  const fake = new FakeBrowser();
  for (const w of init.windows ?? []) fake.addWindow(w);
  init.before?.(fake);
  const log = testLogger();
  const opts: ServiceOptions = { retryDelayMs: null, log, ...init.services };
  const make = (o: ServiceOptions) => {
    const s = createServices(fake.ports(), o);
    s.start();
    return s;
  };
  const h: Harness = {
    fake,
    log,
    opts,
    svc: make(opts),
    placeholderBase: `chrome-extension://${fake.extensionId}/suspended.html`,
    async restart(r = {}) {
      h.svc.stop();
      if (r.browser) fake.restartBrowser();
      else fake.killWorker();
      h.opts = { ...h.opts, ...r.services };
      h.svc = make(h.opts);
      await h.svc.init();
      return h.svc;
    },
    rpc(type, payload, requestId) {
      return h.svc.router.dispatch({
        kind: "tabitat.rpc",
        requestId: requestId ?? `req-${++reqSeq}`,
        type,
        payload,
      }) as Promise<Envelope<CommandOut<typeof type>>>;
    },
    async ok(type, payload) {
      const env = await h.rpc(type, payload);
      if (!env.ok) throw new Error(`${type} failed: ${env.code} ${env.message}`);
      return env.value;
    },
  };
  if (!init.skipInit) await h.svc.init();
  return h;
}

/** Writes a named workspace with the given saved URLs straight into storage (before init). */
export function seedWorkspace(
  fake: FakeBrowser,
  id: string,
  urls: Array<string | Partial<SavedTab>>,
  over: Partial<WorkspaceMeta> = {},
  tabsOver: Partial<WorkspaceTabs> = {},
): WorkspaceTabs {
  const now = fake.clock;
  const tabs: SavedTab[] = urls.map((u, index) => {
    const base = typeof u === "string" ? { url: u } : u;
    return { id: `${id}-t${index}`, title: `T${index}`, index, url: "", ...base } as SavedTab;
  });
  const wt: WorkspaceTabs = { tabs, updatedAt: now, rev: 1, ...tabsOver };
  const meta: WorkspaceMeta = {
    id,
    name: `WS ${id}`,
    color: "blue",
    kind: "named",
    resources: [],
    createdAt: now,
    updatedAt: now,
    rev: 1,
    ...over,
  };
  const index = (fake.local.get(Keys.wsIndex) as string[] | undefined) ?? [];
  fake.local.set(Keys.wsMeta(id), meta);
  fake.local.set(Keys.wsTabs(id), wt);
  fake.local.set(Keys.wsIndex, [...index.filter((x) => x !== id), id]);
  return wt;
}

/** Unwrapped URLs of the window's non-pinned tabs (placeholders resolved). */
export function unwrappedUrls(fake: FakeBrowser, windowId: number, base: string): string[] {
  return fake
    .tabsOf(windowId)
    .filter((t) => !t.pinned)
    .map((t) => parsePlaceholderUrl(t.url, base)?.u ?? t.url);
}

/** saved-tab ids (`s=`) of the window's placeholders. */
export function placeholderIds(fake: FakeBrowser, windowId: number, base: string): string[] {
  return fake
    .tabsOf(windowId)
    .map((t) => parsePlaceholderUrl(t.url, base)?.s)
    .filter((s): s is string => s !== undefined);
}

export function stored<T>(fake: FakeBrowser, key: string): T | undefined {
  return fake.local.get(key) as T | undefined;
}
