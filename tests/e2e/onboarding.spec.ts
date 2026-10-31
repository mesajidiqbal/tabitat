/**
 * Welcome tour e2e (docs/PHASE5.md §1): opened by the worker on first install, four cards and
 * the live shortcuts table, Done stamps `meta.onboardedAt` (read back through the worker) and
 * leaves the page, painted < 300 ms.
 */
import { expect, type Page, test } from "@playwright/test";
import { type LaunchedExtension, launchExtension } from "../support/extension";

test.describe.configure({ mode: "serial" });

let ext: LaunchedExtension;
const extUrl = (path: string) => `chrome-extension://${ext.extensionId}/${path}`;

const readMeta = () =>
  ext.worker.evaluate(
    async () =>
      ((await chrome.storage.local.get("meta")).meta as { onboardedAt?: number } | undefined) ??
      null,
  );

const tourPages = () => ext.context.pages().filter((p) => p.url().endsWith("/onboarding.html"));

test.beforeAll(async () => {
  ext = await launchExtension();
});

test.afterAll(async () => {
  await ext?.close();
});

test("(o1) first install opens the tour once", async () => {
  await expect.poll(() => tourPages().length, { timeout: 15_000 }).toBe(1);
  expect((await readMeta())?.onboardedAt).toBeUndefined();
});

test("(o2) the tour shows four cards and the shortcuts table; painted < 300 ms", async () => {
  const page: Page = await ext.context.newPage();
  await page.bringToFront();
  await page.goto(extUrl("onboarding.html"));
  await expect(page.getByRole("heading", { level: 1, name: "Welcome to Tabitat" })).toBeVisible();
  for (const name of ["Workspaces", "Where things live", "Shortcuts", "Privacy"]) {
    await expect(page.getByRole("region", { name })).toBeVisible();
  }
  await expect(page.locator("[data-card]")).toHaveCount(4);
  await expect(page.getByText(/scroll position/)).toBeVisible();
  await expect(page.getByText(/Install only one of the two/)).toBeVisible();

  const shortcuts = page.getByRole("region", { name: "Shortcuts" });
  await expect(shortcuts.getByRole("table")).toBeVisible();
  await expect(shortcuts.locator("tbody tr")).toHaveCount(5);
  // The command descriptions come from the manifest's __MSG_cmd*__ keys, localized by Chrome.
  await expect(shortcuts.locator("tr[data-command=open-search] td").first()).toHaveText(
    "Search tabs and workspaces",
  );
  await expect(shortcuts.getByRole("button", { name: "Change in Chrome" })).toBeVisible();
  await expect(page).toHaveTitle("Welcome to Tabitat");

  await expect
    .poll(() => page.evaluate(() => performance.getEntriesByName("tabitat:painted").length))
    .toBe(1);
  const painted = await page.evaluate(
    () => performance.getEntriesByName("tabitat:painted")[0]?.startTime ?? null,
  );
  console.log(`[onboarding] painted ${painted?.toFixed(1) ?? "n/a"} ms`);
  expect(painted ?? Infinity).toBeLessThan(300);
  await page.close();
});

test("(o3) Done stamps meta.onboardedAt and closes the tab the worker opened", async () => {
  const [page] = tourPages();
  if (!page) throw new Error("tour tab missing");
  await page.bringToFront();
  const before = Date.now();
  const closed = page.waitForEvent("close", { timeout: 10_000 });
  await page.getByRole("button", { name: "Done" }).click();
  await closed;
  await expect
    .poll(async () => (await readMeta())?.onboardedAt ?? 0, { timeout: 10_000 })
    .toBeGreaterThanOrEqual(before - 1_000);
  expect(tourPages()).toHaveLength(0);
});

test("(o4) when the browser refuses window.close() the page goes to the dashboard", async () => {
  const page = await ext.context.newPage();
  await page.bringToFront();
  await page.goto(extUrl("onboarding.html"));
  // Chrome lets an extension page close its own tab; simulate a refusal (e.g. a forked browser).
  await page.evaluate(() => {
    window.close = () => undefined;
  });
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page).toHaveURL(extUrl("dashboard.html"), { timeout: 10_000 });
  await page.close();
});

test("(o5) options → About opens the tour", async () => {
  const page = await ext.context.newPage();
  await page.bringToFront();
  await page.goto(extUrl("options.html#about"));
  const opened = ext.context.waitForEvent("page");
  await page.getByRole("button", { name: "Show the welcome tour" }).click();
  const tour = await opened;
  await expect(tour).toHaveURL(extUrl("onboarding.html"));
  await expect(tour.getByRole("heading", { level: 1, name: "Welcome to Tabitat" })).toBeVisible();
  await tour.close();
  await page.close();
});
