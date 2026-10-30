/**
 * Phase 2 UI e2e (installed Chrome, built extension). The popup is opened as a tab with
 * `?window=<id>` so it can drive a second window (a switch closes the target window's tabs; a
 * real popup would target its own window). Seeding writes valid records straight into
 * storage.local from the worker, as the UI only reads storage.
 */
import { expect, type Page, test } from "@playwright/test";
import { type LaunchedExtension, launchExtension } from "../support/extension";

test.describe.configure({ mode: "serial" });

const BASE = "http://127.0.0.1:9";
const ALPHA = [`${BASE}/alpha-one`, `${BASE}/alpha-two`];
const BETA = [`${BASE}/beta-one`, `${BASE}/beta-two`, `${BASE}/beta-three`];
const W2_URLS = [`${BASE}/gamma-one`, `${BASE}/gamma-two`];

let ext: LaunchedExtension;
let page: Page;
let w2 = 0;
const extUrl = (path: string) => `chrome-extension://${ext.extensionId}/${path}`;

type Env = { ok: boolean; value?: unknown; message?: string };
const rpc = (type: string, payload: unknown) =>
  page.evaluate(
    ([type, payload]) =>
      chrome.runtime.sendMessage({
        kind: "tabitat.rpc",
        requestId: crypto.randomUUID(),
        type,
        payload,
      }) as Promise<Env>,
    [type, payload] as const,
  );

/** Unwrapped URLs of a window's tabs (placeholders -> their target). */
const windowUrls = (windowId: number) =>
  page.evaluate(async (id) => {
    const base = chrome.runtime.getURL("/suspended.html");
    const tabs = await chrome.tabs.query({ windowId: id });
    return tabs.map((t) => {
      const url = t.url || t.pendingUrl || "";
      const u = url.startsWith(`${base}#`) ? new URLSearchParams(url.split("#")[1]).get("u") : null;
      return { url: u ?? url, placeholder: u !== null, active: t.active };
    });
  }, windowId);

const workspaceOption = (name: string) =>
  page.locator("#ws-list [role=option]").filter({ hasText: name });

test.beforeAll(async () => {
  ext = await launchExtension();
  page = await ext.context.newPage();
  await page.goto(extUrl("popup.html"));
  await expect.poll(async () => (await rpc("system.ping", {}))?.ok, { timeout: 15_000 }).toBe(true);
  w2 = await page.evaluate(
    async (urls) => (await chrome.windows.create({ url: urls, focused: false }))?.id ?? 0,
    W2_URLS,
  );
  // Let the tracker settle (Unsorted workspaces for the new windows) before seeding ws:index.
  await expect
    .poll(() =>
      page.evaluate(
        async (id) => !!(await chrome.storage.local.get(`windows:${id}`))[`windows:${id}`],
        w2,
      ),
    )
    .toBe(true);
});

test.afterAll(async () => {
  await ext?.close();
});

test("(a) popup renders the workspace list from seeded storage; first paint", async () => {
  const now = Date.now();
  const ws = (id: string, name: string, color: string, urls: string[]) => ({
    [`ws:meta:${id}`]: {
      id,
      name,
      color,
      kind: "named",
      resources: [],
      createdAt: now,
      updatedAt: now,
      rev: 1,
    },
    [`ws:tabs:${id}`]: {
      tabs: urls.map((url, i) => ({
        id: `${id}-${i}`,
        url,
        title: `${name} ${url.split("-").pop()}`,
        index: i,
      })),
      updatedAt: now,
      rev: 1,
    },
  });
  const records = { ...ws("alpha", "Alpha", "blue", ALPHA), ...ws("beta", "Beta", "green", BETA) };
  await ext.worker.evaluate(async (recs) => {
    const idx =
      ((await chrome.storage.local.get("ws:index"))["ws:index"] as string[] | undefined) ?? [];
    await chrome.storage.local.set({ ...recs, "ws:index": [...idx, "alpha", "beta"] });
  }, records);

  await page.bringToFront();
  await page.goto(extUrl(`popup.html?window=${w2}`));
  await expect(workspaceOption("Alpha")).toBeVisible();
  await expect(workspaceOption("Beta")).toBeVisible();
  await expect(workspaceOption("Beta")).toContainText("3 tabs");
  await expect
    .poll(() => page.evaluate(() => performance.getEntriesByName("tabitat:painted").length))
    .toBe(1);

  const timing = await page.evaluate(() => ({
    fcp: performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? null,
    rendered: performance.getEntriesByName("tabitat:rendered")[0]?.startTime ?? null,
    painted: performance.getEntriesByName("tabitat:painted")[0]?.startTime ?? null,
  }));
  console.log(
    `[ui-popup] first paint: FCP ${timing.fcp?.toFixed(1) ?? "n/a"} ms; app rendered with data ${timing.rendered?.toFixed(1)} ms; next frame after render ${timing.painted?.toFixed(1) ?? "n/a"} ms`,
  );
  expect(timing.rendered).not.toBeNull();
  // UI-SPEC target is 100 ms (p95, CI gate from Phase 4); this only guards against regressions.
  expect(timing.rendered ?? Infinity).toBeLessThan(500);
  // The frame after render (the first paint with data), relative to navigation start.
  expect(timing.painted).not.toBeNull();
  expect(timing.painted ?? Infinity).toBeLessThan(300);
});

test("(b) creating a workspace from the window via the form updates the list", async () => {
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("textbox", { name: "Workspace name" }).fill("Gamma");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(workspaceOption("Gamma")).toBeVisible();
  await expect(page.getByTestId("active-workspace")).toHaveText("Gamma");
  await expect(workspaceOption("Gamma")).toHaveAttribute("aria-selected", "true");
});

test("(c) clicking another workspace switches the window to its placeholders", async () => {
  await workspaceOption("Beta").click();
  await expect(page.getByTestId("active-workspace")).toHaveText("Beta", { timeout: 10_000 });
  await expect
    .poll(async () => (await windowUrls(w2)).map((t) => t.url).sort(), { timeout: 10_000 })
    .toEqual([...BETA].sort());
  const tabs = await windowUrls(w2);
  // Playwright force-emulates visibility, so placeholders may already have started loading.
  console.log(
    `[ui-popup] after switch: ${tabs.filter((t) => t.placeholder).length}/${tabs.length} still placeholders`,
  );
  await expect(page.locator("[aria-labelledby=tabs-h][role=listbox] [role=option]")).toHaveCount(3);
  await expect(workspaceOption("Gamma")).toContainText("2 tabs");
});

test("(d) search filters and Enter on a tab hit activates it", async () => {
  const search = page.getByRole("combobox", { name: /Search/ });
  await search.fill("beta-two");
  const results = page.locator("#search-results [role=option]");
  await expect(results.first()).toBeVisible();
  await expect(results.first()).toContainText("tab");
  await expect(page.locator("#ws-list")).toHaveCount(0);
  await search.press("Enter");
  await expect
    .poll(async () => (await windowUrls(w2)).find((t) => t.active)?.url)
    .toBe(`${BASE}/beta-two`);
  await search.press("Escape");
  await expect(search).toHaveValue("");
  await expect(page.locator("#ws-list")).toBeVisible();
});

test("(e) recovery page lists session generations; quarantine delete works", async () => {
  const snap = await rpc("session.snapshotNow", {});
  expect(snap.ok).toBe(true);
  await ext.worker.evaluate(() =>
    chrome.storage.local.set({
      "corrupt:ws:meta:zzz": { key: "ws:meta:zzz", raw: 1, error: "bad", at: Date.now() },
    }),
  );
  const rec = await ext.context.newPage();
  await rec.goto(extUrl("recovery.html"));
  await expect(rec.getByTestId("generation").first()).toBeVisible();
  await expect(rec.getByRole("heading", { name: /Quarantined records/ })).toBeVisible();
  const del = rec
    .getByRole("region", { name: /Quarantined/ })
    .getByRole("button", { name: "Delete" });
  await del.click();
  await rec.getByRole("button", { name: "Confirm delete all" }).click();
  await expect(rec.getByRole("heading", { name: /Quarantined records/ })).toHaveCount(0);
  await rec.close();
});
