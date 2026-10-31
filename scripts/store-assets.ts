/**
 * Chrome Web Store assets (docs/PHASE5.md §4): `npm run assets` (after `npm run build`).
 * Launches installed Chrome with the built extension (tests/support/extension.ts), seeds the
 * demo dataset (tests/assets/demo-data.json) through the worker's own import command, and
 * captures popup, side panel, dashboard and options in light and dark into store/screenshots/,
 * plus the two promo tiles rendered from an inline HTML template. Runs with Node's built-in
 * TypeScript type stripping (Node >= 24). No network: every http(s) request from the browser is
 * answered locally with a tiny page carrying the tab's title.
 *
 *   node scripts/store-assets.ts [--headed]
 */
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { CDPSession, Page } from "@playwright/test";
import { type LaunchedExtension, launchExtension } from "../tests/support/extension.ts";

interface DemoTab {
  url: string;
  title: string;
  group?: { id: string; title: string; color: string };
}
interface DemoWorkspace {
  id: string;
  name: string;
  color: string;
  emoji?: string;
  tabs: DemoTab[];
  links: Array<{ url: string; title: string }>;
}
interface Demo {
  openWorkspace: string;
  workspaces: DemoWorkspace[];
  quicklinks: Array<{ url: string; title: string }>;
  todos: Record<string, Array<{ text: string; done: boolean }>>;
  notes: Record<string, string>;
}
interface Envelope {
  ok: boolean;
  value?: unknown;
  code?: string;
  message?: string;
}
type Theme = "light" | "dark";

const OUT = resolve("store");
const SHOTS = join(OUT, "screenshots");
const demo = JSON.parse(readFileSync(resolve("tests/assets/demo-data.json"), "utf8")) as Demo;
const titles = new Map(demo.workspaces.flatMap((w) => w.tabs.map((t) => [t.url, t.title])));

const SURFACES = [
  { name: "popup", path: "popup.html", width: 360, height: 540, scale: 2, ready: "#ws-list" },
  { name: "sidepanel", path: "sidepanel.html", width: 400, height: 800, scale: 2, ready: "main" },
  {
    name: "dashboard",
    path: "dashboard.html",
    width: 1280,
    height: 800,
    scale: 1,
    ready: "#dash-ws-list",
  },
  { name: "options", path: "options.html", width: 1280, height: 800, scale: 1, ready: "main h2" },
] as const;

function rpcIn(page: Page) {
  return async <T>(type: string, payload: unknown): Promise<T> => {
    const env = (await page.evaluate(
      ([type, payload]) =>
        chrome.runtime.sendMessage({
          kind: "tabitat.rpc",
          requestId: crypto.randomUUID(),
          type,
          payload,
        }),
      [type, payload] as const,
    )) as Envelope;
    if (!env?.ok) throw new Error(`${type} failed: ${env?.code} ${env?.message}`);
    return env.value as T;
  };
}

/** Builds a tabitat-backup v1 file from the demo, on top of the extension's own export. */
function demoBackup(base: { data: Record<string, unknown> }, now: number) {
  const minutes = (n: number) => now - n * 60_000;
  const workspaces = demo.workspaces.map((w, wi) => ({
    meta: {
      id: w.id,
      name: w.name,
      color: w.color,
      ...(w.emoji ? { emoji: w.emoji } : {}),
      kind: "named",
      resources: w.links.map((l, i) => ({
        id: `${w.id}-link-${i}`,
        url: l.url,
        title: l.title,
        order: i,
        addedAt: minutes(600 + i),
      })),
      createdAt: minutes(60 * 24 * (10 - wi)),
      updatedAt: minutes(5 + wi * 30),
      rev: 1,
    },
    tabs: {
      tabs: w.tabs.map((t, i) => ({
        id: `${w.id}-tab-${i}`,
        url: t.url,
        title: t.title,
        index: i,
        ...(t.group ? { group: { ...t.group, collapsed: false } } : {}),
      })),
      activeSavedTabId: `${w.id}-tab-0`,
      updatedAt: minutes(5 + wi * 30),
      rev: 1,
    },
  }));
  const todos = Object.fromEntries(
    Object.entries(demo.todos).map(([scope, items]) => [
      scope,
      {
        rev: 1,
        items: items.map((it, i) => ({
          id: `${scope}-todo-${i}`,
          text: it.text,
          done: it.done,
          order: i,
          createdAt: minutes(300 - i),
          ...(it.done ? { doneAt: minutes(30) } : {}),
        })),
      },
    ]),
  );
  const notes = Object.fromEntries(
    Object.entries(demo.notes).map(([scope, content]) => [
      scope,
      { content, updatedAt: minutes(45), rev: 1 },
    ]),
  );
  const quicklinks = {
    rev: 1,
    items: demo.quicklinks.map((q, i) => ({ id: `ql-${i}`, url: q.url, title: q.title, order: i })),
  };
  return { ...base, data: { ...base.data, workspaces, todos, notes, quicklinks } };
}

/** Sets the CSS viewport and device scale factor of one page (persistent contexts share one). */
async function emulate(page: Page, width: number, height: number, scale: number) {
  // Playwright's own viewport first (screenshots use it), then the device scale factor, which a
  // persistent context cannot set per page: CDP on top, kept for the page's lifetime.
  await page.setViewportSize({ width, height });
  const cdp: CDPSession = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: scale,
    mobile: false,
  });
  emulated.set(page, cdp);
}

/** Captures at the emulated device scale (Playwright's screenshot would use the context's 1x). */
async function capture(page: Page, file: string) {
  const cdp = emulated.get(page);
  if (!cdp) throw new Error("page not emulated");
  const { data } = (await cdp.send("Page.captureScreenshot", { format: "png" })) as {
    data: string;
  };
  writeFileSync(file, Buffer.from(data, "base64"));
}

async function settle(page: Page) {
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  await page.waitForTimeout(400);
}

function promoHtml(width: number, height: number, icon: string): string {
  const big = width > 600;
  // The 128 px icon is never scaled up (it would blur): 128 on the marquee, 88 on the tile.
  const iconSize = big ? 128 : 88;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;width:${width}px;height:${height}px;overflow:hidden}
    body{display:flex;align-items:center;justify-content:center;gap:${big ? 48 : 22}px;
      font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#fff;
      background:linear-gradient(135deg,#1d4fb8 0%,#2f6fde 55%,#5b8ff0 100%)}
    img{width:${iconSize}px;height:${iconSize}px;border-radius:${big ? 36 : 20}px;
      background:#fff;padding:${big ? 40 : 12}px;box-shadow:0 12px 32px rgb(0 0 0 / .25)}
    h1{margin:0;font-size:${big ? 96 : 46}px;font-weight:700;letter-spacing:-.02em;line-height:1}
    p{margin:${big ? 18 : 10}px 0 0;font-size:${big ? 34 : 17}px;opacity:.92}
  </style></head><body><img src="${icon}" alt=""><div><h1>Tabitat</h1>
    <p>Workspaces for your tabs</p></div></body></html>`;
}

const emulated = new Map<Page, CDPSession>();
const PROMO_URL = "https://promo.tabitat.invalid/";
let promoBody = "";

async function main() {
  const headed = process.argv.includes("--headed");
  mkdirSync(SHOTS, { recursive: true });
  const ext: LaunchedExtension = await launchExtension({ headed });
  const extUrl = (p: string) => `chrome-extension://${ext.extensionId}/${p}`;
  try {
    // No network: answer every web request locally, with the demo title when we know it.
    await ext.context.route(/^https?:/, (route) => {
      const url = route.request().url();
      if (url.startsWith(PROMO_URL)) {
        return route.fulfill({
          status: 200,
          contentType: "text/html; charset=utf-8",
          body: promoBody,
        });
      }
      const title = titles.get(url) ?? new URL(url).hostname;
      const esc = title.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
      return route.fulfill({
        status: 200,
        contentType: "text/html; charset=utf-8",
        body: `<!doctype html><meta charset="utf-8"><title>${esc}</title><h1>${esc}</h1>`,
      });
    });

    // Drive from the first tab until the worker answers.
    const first = ext.context.pages()[0] ?? (await ext.context.newPage());
    await first.goto(extUrl("options.html"));
    let rpc = rpcIn(first);
    for (let i = 0; i < 50; i++) {
      try {
        await rpc("system.ping", {});
        break;
      } catch {
        await first.waitForTimeout(200);
      }
    }
    // The first-install tour is not part of the screenshots.
    await rpc("system.onboarded", {});

    // One page per surface, each in its own popup-type window: Tabitat tracks normal windows
    // only, so the screenshot pages never show up as tabs or as an "Unsorted" workspace.
    const pages = new Map<string, Page>();
    for (const s of SURFACES) {
      const opened = ext.context.waitForEvent("page");
      await first.evaluate(
        (url) => chrome.windows.create({ type: "popup", url, width: 500, height: 600 }),
        extUrl("options.html"),
      );
      const page = await opened;
      await page.waitForLoadState();
      await emulate(page, s.width, s.height, s.scale);
      pages.set(s.name, page);
    }
    const driver = pages.get("options") as Page;
    rpc = rpcIn(driver);
    // Close the first normal window (its tabs would form an "Unsorted" workspace); the import
    // below then replaces every workspace record.
    // Blank them first so nothing lands in "Recently closed".
    const leftovers = ext.context.pages().filter((p) => ![...pages.values()].includes(p));
    for (const p of leftovers) await p.goto("about:blank");
    await driver.waitForTimeout(1000);
    for (const p of leftovers) await p.close();

    const now = Date.now();
    const base = await rpc<{ data: Record<string, unknown> }>("backup.export", {});
    const report = await rpc<{ warnings: string[] }>("backup.import", {
      file: demoBackup(base, now),
      mode: "replace",
    });
    if (report.warnings.length > 0) console.warn("[assets] import warnings:", report.warnings);
    const { windowId } = await rpc<{ windowId: number }>("workspace.open", {
      workspaceId: demo.openWorkspace,
    });
    await driver.waitForTimeout(1500); // placeholders created, tracker settled

    const written: string[] = [];
    // Every dashboard card, so the screenshot shows notes and the pomodoro too.
    await rpc("settings.update", {
      patch: {
        dashboard: {
          widgets: ["clock", "search", "quicklinks", "workspaces", "todos", "notes", "pomodoro"],
        },
      },
    });
    for (const theme of ["light", "dark"] as Theme[]) {
      await rpc("settings.update", { patch: { theme } });
      for (const s of SURFACES) {
        const page = pages.get(s.name) as Page;
        await page.bringToFront();
        const query = s.name === "options" ? "" : `?window=${windowId}`;
        await page.goto(extUrl(`${s.path}${query}`));
        await page.waitForSelector(s.ready, { timeout: 15_000 });
        await settle(page);
        const file = join(SHOTS, `${s.name}-${theme}.png`);
        await capture(page, file);
        written.push(file);
      }
    }

    const icon = `data:image/png;base64,${readFileSync(resolve("public/icon/128.png")).toString("base64")}`;
    const promo = pages.get("dashboard") as Page;
    for (const [w, h] of [
      [440, 280],
      [1400, 560],
    ] as const) {
      await emulate(promo, w, h, 1);
      // A routed web page: extension pages forbid inline styles (CSP), this one has none.
      promoBody = promoHtml(w, h, icon);
      await promo.goto(`${PROMO_URL}${w}x${h}`);
      await settle(promo);
      const file = join(OUT, `promo-${w}x${h}.png`);
      await capture(promo, file);
      written.push(file);
    }

    let total = 0;
    for (const f of written) {
      const size = statSync(f).size;
      total += size;
      console.log(`${f.slice(process.cwd().length + 1)}  ${(size / 1024).toFixed(1)} KB`);
    }
    console.log(`${written.length} files, ${(total / 1024).toFixed(1)} KB`);
  } finally {
    await ext.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
