/**
 * Phase 4 dashboard e2e (installed Chrome, built extension; docs/PHASE4.md §8 (i)(j)(k)(m)).
 * Seeding writes valid records straight into storage.local from the worker (the UI only reads
 * storage); every UI write must come back through the worker with a bumped rev.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { type LaunchedExtension, launchExtension } from "../support/extension";

test.describe.configure({ mode: "serial" });

const BASE = "http://127.0.0.1:9";
let ext: LaunchedExtension;
let page: Page;
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
const readKey = <T>(key: string) =>
  ext.worker.evaluate(async (k) => (await chrome.storage.local.get(k))[k], key) as Promise<
    T | undefined
  >;

test.beforeAll(async () => {
  ext = await launchExtension();
  page = await ext.context.newPage();
  await page.goto(extUrl("dashboard.html"));
  await expect.poll(async () => (await rpc("system.ping", {}))?.ok, { timeout: 15_000 }).toBe(true);
  // The worker's first-run migration writes the missing defaults from a start-up snapshot: seed
  // only after it has written `meta`, or a seed can be overwritten (as in export.spec.ts).
  await expect
    .poll(async () => (await readKey("meta")) !== undefined, { timeout: 15_000 })
    .toBe(true);
});

test.afterAll(async () => {
  await ext?.close();
});

test("(i) dashboard renders seeded workspaces and quick links; painted < 300 ms", async () => {
  const now = Date.now();
  const ws = (id: string, name: string, color: string, n: number) => ({
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
      tabs: Array.from({ length: n }, (_, i) => ({
        id: `${id}-${i}`,
        url: `${BASE}/${id}-${i}`,
        title: `${name} ${i}`,
        index: i,
      })),
      updatedAt: now,
      rev: 1,
    },
  });
  const records = {
    ...ws("alpha", "Alpha", "blue", 2),
    ...ws("beta", "Beta", "green", 3),
    quicklinks: {
      rev: 1,
      items: [
        { id: "q1", url: `${BASE}/docs`, title: "Team Docs", order: 0 },
        { id: "q2", url: `${BASE}/mail`, title: "Webmail", order: 1 },
      ],
    },
  };
  await ext.worker.evaluate(async (recs) => {
    const idx =
      ((await chrome.storage.local.get("ws:index"))["ws:index"] as string[] | undefined) ?? [];
    await chrome.storage.local.set({ ...recs, "ws:index": [...idx, "alpha", "beta"] });
  }, records);

  await page.bringToFront();
  await page.goto(extUrl("dashboard.html"));
  const cards = page.locator("#dash-ws-list [role=row]");
  await expect(cards.filter({ hasText: "Alpha" })).toBeVisible();
  await expect(cards.filter({ hasText: "Beta" })).toContainText("3 tabs");
  await expect(page.getByRole("link", { name: "Team Docs" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Webmail" })).toBeVisible();
  await expect(page.locator("[data-widget=clock]")).toBeVisible();
  await expect(page.getByRole("combobox", { name: /Search/ })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => performance.getEntriesByName("tabitat:painted").length))
    .toBe(1);

  const timing = await page.evaluate(() => ({
    fcp: performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? null,
    rendered: performance.getEntriesByName("tabitat:rendered")[0]?.startTime ?? null,
    painted: performance.getEntriesByName("tabitat:painted")[0]?.startTime ?? null,
  }));
  console.log(
    `[dashboard] FCP ${timing.fcp?.toFixed(1) ?? "n/a"} ms; rendered ${timing.rendered?.toFixed(1)} ms; painted ${timing.painted?.toFixed(1) ?? "n/a"} ms`,
  );
  expect(timing.painted).not.toBeNull();
  // §5: CI headroom; the 50 ms target is checked locally.
  expect(timing.painted ?? Infinity).toBeLessThan(300);
});

test("(j) adding a todo and a quick link persists through the worker", async () => {
  const before = (await readKey<{ rev: number }>("todos:global"))?.rev ?? 0;
  const add = page.getByRole("textbox", { name: "Add a task" });
  await add.fill("Write the e2e test");
  await add.press("Enter");
  await expect(page.getByRole("listitem").filter({ hasText: "Write the e2e test" })).toBeVisible();
  await expect
    .poll(async () => {
      const list = await readKey<{ rev: number; items: Array<{ text: string }> }>("todos:global");
      return { rev: list?.rev, texts: list?.items.map((x) => x.text) };
    })
    .toEqual({ rev: before + 1, texts: ["Write the e2e test"] });

  await page.getByRole("button", { name: "Add quick link" }).first().click();
  await page.getByRole("textbox", { name: "URL" }).fill("example.org/start");
  await page.getByRole("textbox", { name: "Title" }).fill("Example Org");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("link", { name: "Example Org" })).toBeVisible();
  await expect
    .poll(async () => {
      const ql = await readKey<{ rev: number; items: Array<{ url: string; title: string }> }>(
        "quicklinks",
      );
      return { rev: ql?.rev, last: ql?.items.at(-1) };
    })
    .toEqual({
      rev: 2,
      last: expect.objectContaining({ url: "https://example.org/start", title: "Example Org" }),
    });
});

test("(j2) two dashboards adding todos at once: both land, written with the higher rev", async () => {
  const before = (await readKey<{ rev: number }>("todos:global"))?.rev ?? 0;
  const other = await ext.context.newPage();
  await other.goto(extUrl("dashboard.html"));
  const boxA = page.getByRole("textbox", { name: "Add a task" });
  const boxB = other.getByRole("textbox", { name: "Add a task" });
  await expect(boxB).toBeVisible();
  await boxA.fill("From page A");
  await boxB.fill("From page B");
  // Both Enters go out before either page has seen the other's write: one of them conflicts,
  // re-reads and replays its add on top of the other.
  await Promise.all([boxA.press("Enter"), boxB.press("Enter")]);
  await expect
    .poll(async () => {
      const list = await readKey<{ rev: number; items: Array<{ text: string }> }>("todos:global");
      const texts = list?.items.map((x) => x.text) ?? [];
      return {
        a: texts.includes("From page A"),
        b: texts.includes("From page B"),
        rev: (list?.rev ?? 0) >= before + 2,
      };
    })
    .toEqual({ a: true, b: true, rev: true });
  // Both pages show both items, and both boxes were cleared once their write was acknowledged.
  for (const p of [page, other]) {
    for (const text of ["From page A", "From page B"])
      await expect(p.getByRole("listitem").filter({ hasText: text })).toBeVisible();
    await expect(p.getByRole("textbox", { name: "Add a task" })).toHaveValue("");
  }
  await expect(page.getByTestId("save-error")).toHaveCount(0);
  await other.close();
});

test("(n) the backup banner shows on the dashboard when a reminder is due", async () => {
  const DAY = 24 * 60 * 60 * 1000;
  const now = Date.now();
  await ext.worker.evaluate(
    async ([now, DAY]) => {
      const meta = (await chrome.storage.local.get("meta")).meta as Record<string, unknown>;
      await chrome.storage.local.set({
        meta: { ...meta, installedAt: now - 40 * DAY },
        "backup:reminder": { dueSince: now - DAY },
      });
    },
    [now, DAY] as const,
  );
  await page.bringToFront();
  await page.goto(extUrl("dashboard.html"));
  const banner = page.getByTestId("backup-banner");
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("No backup yet");
  await expect(banner.getByRole("button", { name: "Turn off" })).toBeEnabled();
  // Snooze hides it (the worker writes snoozedUntil; the banner follows storage).
  await banner.getByRole("button", { name: "Remind me in a week" }).click();
  await expect(banner).toHaveCount(0);
  await expect
    .poll(async () => (await readKey<{ snoozedUntil?: number }>("backup:reminder"))?.snoozedUntil)
    .toBeGreaterThan(now);
  await ext.worker.evaluate(() => chrome.storage.local.remove("backup:reminder"));
});

test("(k) pomodoro: enable the widget, Start shows a countdown and sets the key", async () => {
  const settingsRev = (await readKey<{ rev: number }>("settings"))?.rev ?? 0;
  await page.getByRole("button", { name: "Customize" }).click();
  const dialog = page.getByRole("dialog", { name: "Customize" });
  await dialog.getByRole("checkbox", { name: "Pomodoro" }).check();
  await expect
    .poll(async () => await readKey<{ rev: number; dashboard: { widgets: string[] } }>("settings"))
    .toMatchObject({
      rev: settingsRev + 1,
      dashboard: { widgets: expect.arrayContaining(["pomodoro"]) },
    });
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  const card = page.locator("[data-widget=pomodoro]");
  await page.bringToFront();
  await card.getByRole("button", { name: "Start" }).click();
  const remaining = card.getByTestId("pomodoro-remaining");
  await expect
    .poll(() => readKey<{ phase: string; endsAt: number; round: number }>("pomodoro"))
    .toMatchObject({ phase: "work", round: 1 });
  await expect(remaining).toHaveText(/^(25:00|24:[0-5]\d)$/);
  const first = await remaining.textContent();
  await expect.poll(() => remaining.textContent(), { timeout: 5_000 }).not.toBe(first);
  await expect(page).toHaveTitle(/^\d\d:\d\d · Tabitat$/);
  await expect(card).toContainText("Round 1 / 4");

  await card.getByRole("button", { name: "Stop" }).click();
  // The worker clears the record (null) or removes the key.
  await expect.poll(() => readKey("pomodoro")).toBeFalsy();
  await expect(page).toHaveTitle("Tabitat");
});

test("(m) the newtab flavor overrides the new tab page with dashboard.html", () => {
  const file = resolve(".output-newtab/chrome-mv3/manifest.json");
  expect(existsSync(file), "run `npm run build:newtab` first").toBe(true);
  const manifest = JSON.parse(readFileSync(file, "utf8")) as {
    chrome_url_overrides?: { newtab?: string };
  };
  expect(manifest.chrome_url_overrides?.newtab).toBe("dashboard.html");
  const plain = JSON.parse(readFileSync(resolve(".output/chrome-mv3/manifest.json"), "utf8"));
  expect(plain.chrome_url_overrides).toBeUndefined();
});
