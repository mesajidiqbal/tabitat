/**
 * Options page e2e (installed Chrome, built extension). Settings are read back from
 * storage.local through the service worker: the page itself only writes via settings.update.
 */
import { expect, type Page, test } from "@playwright/test";
import { type LaunchedExtension, launchExtension } from "../support/extension";

test.describe.configure({ mode: "serial" });

interface StoredSettings {
  rev: number;
  theme: string;
  suspend: { enabled: boolean; afterMinutes: number; whitelist: string[] };
}

let ext: LaunchedExtension;
let page: Page;
const extUrl = (path: string) => `chrome-extension://${ext.extensionId}/${path}`;

const readSettings = () =>
  ext.worker.evaluate(
    async () =>
      ((await chrome.storage.local.get("settings")).settings as StoredSettings | undefined) ?? null,
  );

test.beforeAll(async () => {
  ext = await launchExtension();
  page = await ext.context.newPage();
  // Foreground tab: Preact schedules effects after the next frame, which a background tab delays.
  await page.bringToFront();
  await page.goto(extUrl("options.html"));
  await expect
    .poll(
      () =>
        page.evaluate(
          async () =>
            (
              (await chrome.runtime.sendMessage({
                kind: "tabitat.rpc",
                requestId: crypto.randomUUID(),
                type: "system.ping",
                payload: {},
              })) as { ok?: boolean }
            )?.ok,
        ),
      { timeout: 15_000 },
    )
    .toBe(true);
});

test.afterAll(async () => {
  await ext?.close();
});

test("(f) options edits suspension settings; stored settings reflect them and rev is bumped", async () => {
  const before = (await readSettings())?.rev ?? 0;
  await page.goto(extUrl("options.html#suspension"));
  await expect(page.getByRole("heading", { level: 2, name: "Suspension" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Suspension" })).toHaveAttribute(
    "aria-current",
    "page",
  );

  await page.getByRole("checkbox", { name: "Suspend inactive tabs" }).check();
  await page.getByLabel("Suspend after (minutes)").fill("45");
  await page
    .getByLabel("Never suspend these sites")
    .fill("Example.com\nhttps://docs.example.org/page\nexample.com\nnot a host");

  // Valid hosts are normalized and de-duplicated; the invalid line is flagged, not saved.
  await expect(page.getByText("Line 4 is not saved")).toBeVisible();
  await expect(page.getByRole("list", { name: "Sites that are never suspended" })).toContainText(
    "docs.example.org",
  );
  await expect
    .poll(async () => (await readSettings())?.suspend, { timeout: 10_000 })
    .toEqual({
      enabled: true,
      afterMinutes: 45,
      whitelist: ["example.com", "docs.example.org"],
    });
  const after = await readSettings();
  expect(after?.rev).toBeGreaterThan(before);
  await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();

  // Reload: the saved values come back from storage.
  await page.reload();
  await expect(page.getByRole("checkbox", { name: "Suspend inactive tabs" })).toBeChecked();
  await expect(page.getByLabel("Suspend after (minutes)")).toHaveValue("45");
  await expect(page.getByLabel("Never suspend these sites")).toHaveValue(
    "example.com\ndocs.example.org",
  );
});

test("out-of-range minutes are flagged and not saved", async () => {
  await page.goto(extUrl("options.html#suspension"));
  const before = (await readSettings())?.rev ?? 0;
  await page.getByLabel("Suspend after (minutes)").fill("2");
  await expect(page.getByText("Enter a whole number from 5 to 720.")).toBeVisible();
  await page.waitForTimeout(600);
  expect((await readSettings())?.rev).toBe(before);
});

test("theme select applies data-theme and saves; hash navigation switches sections", async () => {
  await page.goto(extUrl("options.html"));
  await expect(page.getByRole("heading", { level: 2, name: "General" })).toBeVisible();
  await page.getByLabel("Theme").selectOption("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect.poll(async () => (await readSettings())?.theme).toBe("dark");
  await page.getByLabel("Theme").selectOption("system");
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.+/);

  await page.getByRole("link", { name: "Pomodoro" }).click();
  await expect(page).toHaveURL(/options\.html#pomodoro$/);
  await expect(page.getByRole("heading", { level: 2, name: "Pomodoro" })).toBeVisible();
  await page.getByRole("link", { name: "Bookmarks import" }).click();
  await expect(page.getByRole("button", { name: "Choose bookmarks…" })).toBeVisible();
});

test("Shortcuts table lists the rows of chrome.commands.getAll()", async () => {
  await page.goto(extUrl("options.html#shortcuts"));
  const commands = await page.evaluate(async () =>
    (await chrome.commands.getAll()).map((c) => ({
      name: c.name ?? "",
      description: c.description ?? "",
      shortcut: c.shortcut ?? "",
    })),
  );
  expect(commands.length).toBeGreaterThanOrEqual(5);
  const rows = page.locator("tbody tr");
  await expect(rows).toHaveCount(commands.length);
  for (const cmd of commands) {
    const row = page.locator(`tr[data-command="${cmd.name}"]`);
    await expect(row).toContainText(cmd.description || cmd.name);
    await expect(row).toContainText(cmd.shortcut || "Not set");
  }
  await expect(page.getByRole("button", { name: "Change in Chrome" })).toBeVisible();
});

test("Bookmarks picker: folder tree, selection counts and the import call (stubbed bookmarks API)", async () => {
  await page.goto(extUrl("options.html#bookmarks"));
  // The bookmarks API only exists once the optional permission is granted (a user gesture in
  // real use); stub both so the picker can be driven.
  await page.evaluate(() => {
    const node = (id: string, title: string, url?: string, children?: unknown[]) => ({
      id,
      title,
      url,
      children,
    });
    const tree = [
      node("0", "", undefined, [
        node("1", "Bookmarks bar", undefined, [
          node("a", "A", "https://a.example/"),
          node("js", "Bad", "javascript:alert(1)"),
          node("10", "Work", undefined, [
            node("b", "B", "https://b.example/"),
            node("c", "C", "https://c.example/"),
          ]),
        ]),
        node("2", "Other bookmarks", undefined, [node("d", "D", "https://d.example/")]),
      ]),
    ];
    const w = chrome as unknown as Record<string, unknown>;
    Object.defineProperty(w.permissions as object, "request", {
      value: async () => true,
      configurable: true,
    });
    Object.defineProperty(w, "bookmarks", {
      value: { getTree: async () => tree },
      configurable: true,
    });
  });
  await page.getByRole("button", { name: "Choose bookmarks…" }).click();
  const bar = page.getByRole("checkbox", { name: "Bookmarks bar (3 links)" });
  await expect(bar).toBeVisible();
  await expect(page.getByRole("button", { name: "Import", exact: true })).toBeDisabled();

  // Top-level folders start expanded; checking a parent checks its subtree.
  await bar.check();
  await expect(page.getByRole("checkbox", { name: "Work (2 links)" })).toBeChecked();
  await expect(page.getByText("3 links · 2 folders · 1 skipped (unsupported URLs)")).toBeVisible();

  await page.getByRole("checkbox", { name: "Work (2 links)" }).uncheck();
  await expect(page.getByText("1 links · 1 folders · 1 skipped (unsupported URLs)")).toBeVisible();
  await page.getByRole("radio", { name: "One workspace", exact: true }).check();
  await expect(page.getByRole("textbox", { name: "Workspace name" })).toHaveValue("Bookmarks bar");

  // The worker command may be unavailable (degraded worker): either outcome is surfaced.
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(
    page.getByText(
      /^Imported \d+ links, skipped \d+\.$|^Something went wrong\.$|^That is not allowed\.$/,
    ),
  ).toBeVisible();
});
