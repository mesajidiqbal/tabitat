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
  backupReminderDays?: number;
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
  await page.getByLabel("Suspend after (minutes)").fill("47");
  const whitelist = page.getByLabel("Never suspend these sites");
  await whitelist.fill("Example.com\nhttps://docs.example.org/page\nexample.com\nnot a host");

  // An invalid line blocks saving the whole list (it may be a protected host being edited).
  await expect(page.getByText("Line 4: “not a host” is not a valid host.")).toBeVisible();
  await expect(whitelist).toHaveAttribute("aria-invalid", "true");
  await expect
    .poll(async () => (await readSettings())?.suspend, { timeout: 10_000 })
    .toEqual({ enabled: true, afterMinutes: 47, whitelist: [] });
  await whitelist.blur();
  await page.waitForTimeout(500);
  expect((await readSettings())?.suspend.whitelist).toEqual([]);

  // Valid hosts are normalized and de-duplicated, then saved.
  await whitelist.fill("Example.com\nhttps://docs.example.org/page\nexample.com");
  await expect(whitelist).not.toHaveAttribute("aria-invalid", "true");
  await expect(page.getByRole("list", { name: "Sites that are never suspended" })).toContainText(
    "docs.example.org",
  );
  await expect
    .poll(async () => (await readSettings())?.suspend, { timeout: 10_000 })
    .toEqual({
      enabled: true,
      afterMinutes: 47,
      whitelist: ["example.com", "docs.example.org"],
    });
  const after = await readSettings();
  expect(after?.rev).toBeGreaterThan(before);
  await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();

  // Reload: the saved values come back from storage.
  await page.reload();
  await expect(page.getByRole("checkbox", { name: "Suspend inactive tabs" })).toBeChecked();
  await expect(page.getByLabel("Suspend after (minutes)")).toHaveValue("47");
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
  await expect(page).toHaveTitle("Tabitat settings");
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

test("Bookmarks picker: folder tree, selection counts and a quick-links import (stubbed bookmarks API)", async () => {
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

  // Import into quick links: the worker command succeeds and the links are stored.
  await page.getByRole("checkbox", { name: "Work (2 links)" }).check();
  await page.getByRole("radio", { name: "Quick links" }).check();
  await expect(page.getByText("Will add 3, skip 0.")).toBeVisible();
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.getByText("Imported 3 links, skipped 0.")).toBeVisible();
  const quickUrls = () =>
    ext.worker.evaluate(async () => {
      const q = (await chrome.storage.local.get("quicklinks")).quicklinks as
        | { items?: Array<{ url: string }> }
        | undefined;
      return (q?.items ?? []).map((i) => i.url).sort();
    });
  await expect
    .poll(quickUrls)
    .toEqual(["https://a.example/", "https://b.example/", "https://c.example/"]);

  // The preview runs the worker's planner: importing again would only find duplicates.
  await expect(page.getByText("Will add 0, skip 3.")).toBeVisible();
  await expect(page.getByText("3 skipped: already there or listed twice.").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove bookmarks permission" })).toBeVisible();
});

test("Bookmarks per-folder import: one selected folder roots the mapping; several become one workspace each", async () => {
  await page.goto(extUrl("options.html#bookmarks"));
  await page.reload(); // same-document hash navigation would keep the previous picker state
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
          node("dev", "Dev", undefined, [
            node("docs", "Docs", undefined, [
              node("deep", "Deep", undefined, [node("x", "X", "https://x.example/")]),
            ]),
          ]),
        ]),
        node("2", "Other bookmarks", undefined, [
          node("misc", "Misc", undefined, [node("y", "Y", "https://y.example/")]),
        ]),
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
  const wsNames = () =>
    ext.worker.evaluate(async () => {
      const all = await chrome.storage.local.get(null);
      return Object.entries(all)
        .filter(([k]) => k.startsWith("ws:meta:"))
        .map(([, v]) => (v as { name: string }).name)
        .sort();
    });
  const before = await wsNames();
  await page.getByRole("button", { name: "Choose bookmarks…" }).click();
  await page.getByRole("button", { name: "Expand or collapse Bookmarks bar" }).waitFor();
  await page.getByRole("radio", { name: "One workspace per selected folder" }).check();

  // One topmost folder ("Dev", no direct links): its direct subfolder "Docs" becomes the workspace.
  await page.getByRole("checkbox", { name: "Dev (1 links)" }).check();
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.getByText("Imported 1 links, skipped 0.")).toBeVisible();
  await expect.poll(wsNames).toEqual([...before, "Docs"].sort());

  // Two topmost folders under different roots: one workspace per folder.
  await page.getByRole("checkbox", { name: "Dev (1 links)" }).uncheck();
  await page.getByRole("button", { name: "Expand or collapse Dev" }).click();
  await page.getByRole("checkbox", { name: "Docs (1 links)" }).check();
  await page.getByRole("checkbox", { name: "Misc (1 links)" }).check();
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.getByText("Imported 2 links, skipped 0.")).toBeVisible();
  await expect.poll(wsNames).toEqual([...before, "Docs", "Docs", "Misc"].sort());
});

test("Data section: the backup reminder field validates, saves backupReminderDays and shows the last backup", async () => {
  await page.goto(extUrl("options.html#data"));
  await expect(page.getByRole("heading", { level: 2, name: "Data" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Export HTML" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Strip query strings" })).not.toBeChecked();
  await expect(page.getByText("Last backup: never")).toBeVisible();

  const field = page.getByLabel("Remind me to back up every (days)");
  await expect(field).toHaveValue("30");
  const before = (await readSettings())?.rev ?? 0;
  await field.fill("3");
  await expect(page.getByText("Enter 0 (off) or a whole number from 7 to 365.")).toBeVisible();
  await page.waitForTimeout(600);
  expect((await readSettings())?.rev).toBe(before);

  await field.fill("14");
  await expect.poll(async () => (await readSettings())?.backupReminderDays).toBe(14);
  await field.fill("0");
  await expect.poll(async () => (await readSettings())?.backupReminderDays).toBe(0);
  await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();

  await page.reload();
  await expect(page.getByLabel("Remind me to back up every (days)")).toHaveValue("0");
});

test("Data section: the backup banner shows for a due reminder and Turn off disables the reminder", async () => {
  await ext.worker.evaluate(async () => {
    // A fresh profile is never "due": age the install so the worker's own evaluation agrees.
    const meta = (await chrome.storage.local.get("meta")).meta as Record<string, unknown>;
    await chrome.storage.local.set({
      meta: { ...meta, installedAt: Date.now() - 40 * 86_400_000 },
      "backup:reminder": { dueSince: Date.now() - 86_400_000 },
    });
  });
  await page.goto(extUrl("options.html#data"));
  await page.getByLabel("Remind me to back up every (days)").fill("30");
  await expect.poll(async () => (await readSettings())?.backupReminderDays).toBe(30);
  const banner = page.getByTestId("backup-banner");
  await expect(banner).toContainText("No backup yet");
  await expect(banner.getByRole("button", { name: "Export" })).toBeVisible();
  await expect(banner.getByRole("button", { name: "Remind me in a week" })).toBeVisible();
  await banner.getByRole("button", { name: "Turn off" }).click();
  await expect.poll(async () => (await readSettings())?.backupReminderDays).toBe(0);
  // Clean up the seeded record so later tests start without a banner.
  await ext.worker.evaluate(() => chrome.storage.local.remove("backup:reminder"));
  await expect(banner).toHaveCount(0);
});

test("lazy sections: the skeleton gives way to the section and hash navigation reaches About", async () => {
  await page.goto(extUrl("options.html#about"));
  await expect(page.getByRole("heading", { level: 2, name: "About" })).toBeVisible();
  await expect(page.getByRole("link", { name: "https://github.com/" })).toBeVisible();
  await page.getByRole("link", { name: "Data" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Data" })).toBeVisible();
});
