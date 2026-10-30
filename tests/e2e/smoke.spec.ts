import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type BrowserContext, chromium, expect, test } from "@playwright/test";

const extensionPath = resolve("./.output/chrome-mv3");

test.skip(!existsSync(extensionPath), "build the extension first (npm run build)");

let context: BrowserContext;

test.beforeAll(async () => {
  context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "tabitat-")), {
    headless: false,
    args: [
      "--headless=new",
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });
});

test.afterAll(async () => {
  await context?.close();
});

test("popup renders", async () => {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  const extensionId = new URL(worker.url()).host;
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(page.getByText("Tabitat")).toBeVisible();
});
