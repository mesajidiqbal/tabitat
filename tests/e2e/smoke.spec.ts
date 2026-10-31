import { expect, test } from "@playwright/test";
import { freshDir, sleep } from "../spike/harness";
import { RawChrome } from "../spike/rawcdp";
import { type LaunchedExtension, launchExtension } from "../support/extension";

let ext: LaunchedExtension;

test.beforeAll(async () => {
  ext = await launchExtension({
    browser: process.env.SPIKE_BROWSER === "brave" ? "brave" : "chrome",
  });
});

test.afterAll(async () => {
  await ext?.close();
});

test("popup renders", async () => {
  const page = await ext.context.newPage();
  await page.goto(`chrome-extension://${ext.extensionId}/popup.html`);
  // The footer brand (the page also has an sr-only "Tabitat" h1).
  await expect(page.getByRole("contentinfo").getByText("Tabitat")).toBeVisible();
});

// Playwright force-enables visibility emulation on every page in its context (even tabs created
// by the worker), so inactive tabs would report "visible" and navigate. Use the raw CDP driver,
// which never attaches to page targets, to test the real hidden-tab behaviour.
test("background placeholder does not navigate", async () => {
  const rc = new RawChrome(freshDir());
  await rc.start();
  try {
    const url = `chrome-extension://${rc.extId}/suspended.html#u=https%3A%2F%2Fexample.com&t=Ex&w=x&s=y`;
    const id = await rc.evalWorker<number>(
      `return (await chrome.tabs.create({ url: ${JSON.stringify(url)}, active: false })).id`,
    );
    await sleep(2000);
    const current = await rc.evalWorker<string>(`return (await chrome.tabs.get(${id})).url`);
    expect(current).toBe(url);
  } finally {
    await rc.quit();
  }
});
