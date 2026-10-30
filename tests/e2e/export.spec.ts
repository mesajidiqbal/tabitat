/**
 * Phase 4 export e2e (installed Chrome, built extension): HTML export from the recovery page and
 * the per-generation sessions export. Records are seeded straight into storage.local from the
 * worker (the UI only reads storage); the export itself runs in the worker.
 */
import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";
import { type LaunchedExtension, launchExtension } from "../support/extension";

test.describe.configure({ mode: "serial" });

const BASE = "http://127.0.0.1:9";
const ALPHA_TAB = `${BASE}/alpha-tab?x=1#frag`;
const ALPHA_LINK = `${BASE}/alpha-link?utm=1`;
const BETA_TAB = `${BASE}/beta-tab?token=2`;
const QUICK = `${BASE}/quick?q=3`;

let ext: LaunchedExtension;
let page: Page;
const extUrl = (path: string) => `chrome-extension://${ext.extensionId}/${path}`;

const ws = (id: string, name: string, tab: string, link?: string) => {
  const now = Date.now();
  return {
    [`ws:meta:${id}`]: {
      id,
      name,
      color: "blue",
      kind: "named",
      resources: link
        ? [{ id: `${id}-l`, url: link, title: `${name} link`, order: 0, addedAt: now }]
        : [],
      createdAt: now,
      updatedAt: now,
      rev: 1,
    },
    [`ws:tabs:${id}`]: {
      tabs: [{ id: `${id}-t`, url: tab, title: `${name} tab`, index: 0 }],
      updatedAt: now,
      rev: 1,
    },
  };
};

const seed = (records: Record<string, unknown>, addToIndex: string[] = []) =>
  ext.worker.evaluate(
    async ([recs, ids]) => {
      const idx =
        ((await chrome.storage.local.get("ws:index"))["ws:index"] as string[] | undefined) ?? [];
      await chrome.storage.local.set({ ...recs, "ws:index": [...idx, ...ids] });
    },
    [records, addToIndex] as const,
  );

/** Clicks `name` inside the recovery card named `region`, and returns the downloaded file text. */
async function downloadFrom(region: string, name: string | RegExp): Promise<string> {
  const download = page.waitForEvent("download");
  await page.getByRole("region", { name: region }).getByRole("button", { name }).click();
  const path = await (await download).path();
  return readFile(path, "utf8");
}

test.beforeAll(async () => {
  ext = await launchExtension();
  page = await ext.context.newPage();
  await page.bringToFront();
  await page.goto(extUrl("recovery.html"));
  // The worker's first-run migration plans from a snapshot taken at start-up and then writes the
  // missing defaults: seed only after it has written `meta`, or the seed is overwritten.
  await expect
    .poll(
      async () =>
        (await ext.worker.evaluate(() => chrome.storage.local.get("meta"))).meta !== undefined,
      { timeout: 15_000 },
    )
    .toBe(true);
  await seed(
    {
      ...ws("alpha", "Alpha", ALPHA_TAB, ALPHA_LINK),
      ...ws("beta", "Beta", BETA_TAB),
      quicklinks: {
        items: [{ id: "q1", url: QUICK, title: "Quick one", order: 0 }],
        rev: 1,
      },
      "sessions:index": [1],
      "sessions:gen:1": {
        id: 1,
        takenAt: Date.now() - 60_000,
        windows: [
          {
            windowId: 1,
            workspaceId: "alpha",
            tabs: [{ id: "s1", url: `${BASE}/session-tab?s=1`, title: "Session tab", index: 0 }],
          },
        ],
      },
    },
    ["alpha", "beta"],
  );
  await page.goto(extUrl("recovery.html"));
  await expect(page.getByRole("region", { name: "Backup and export" })).toBeVisible();
});

test.afterAll(async () => {
  await ext?.close();
});

test("the recovery page's backup card offers the JSON backup, HTML export and the strip option", async () => {
  const card = page.getByRole("region", { name: "Backup and export" });
  await expect(card.getByRole("button", { name: "Export backup" })).toBeVisible();
  await expect(card.getByRole("button", { name: "Export HTML" })).toBeVisible();
  const strip = card.getByRole("checkbox", { name: "Strip query strings" });
  await expect(strip).not.toBeChecked();

  // The choice is remembered across reloads (localStorage) and shared with the sessions card.
  await strip.check();
  await page.reload();
  await expect(card.getByRole("checkbox", { name: "Strip query strings" })).toBeChecked();
  await expect(
    page.getByRole("region", { name: "Session snapshots" }).getByRole("checkbox", {
      name: "Strip query strings",
    }),
  ).toBeChecked();
  await card.getByRole("checkbox", { name: "Strip query strings" }).uncheck();
});

test("sessions page: each snapshot has its own Export HTML button", async () => {
  const gen = page.getByTestId("generation");
  await expect(gen).toHaveCount(1);
  await expect(
    gen.getByRole("button", { name: /^Export HTML of the snapshot from / }),
  ).toBeVisible();
  // The Phase 3 per-page "Export backup" moved to the backup card.
  await expect(
    page.getByRole("region", { name: "Session snapshots" }).getByRole("button", {
      name: "Export backup",
    }),
  ).toHaveCount(0);
});

// The worker-side commands land in a parallel change; the orchestrator un-skips these after the merge.
test("(l) HTML export from the recovery page contains every workspace and link, and strips queries when asked", async () => {
  const full = await downloadFrom("Backup and export", "Export HTML");
  expect(full).toContain("<!DOCTYPE NETSCAPE-Bookmark-file-1>");
  for (const text of ["Alpha", "Beta", ALPHA_TAB, ALPHA_LINK, BETA_TAB, QUICK])
    expect(full).toContain(text.replaceAll("&", "&amp;"));

  await page
    .getByRole("region", { name: "Backup and export" })
    .getByRole("checkbox", { name: "Strip query strings" })
    .check();
  const stripped = await downloadFrom("Backup and export", "Export HTML");
  for (const text of [
    "Alpha",
    "Beta",
    `${BASE}/alpha-tab`,
    `${BASE}/alpha-link`,
    `${BASE}/beta-tab`,
    `${BASE}/quick`,
  ])
    expect(stripped).toContain(text);
  for (const gone of ["x=1", "#frag", "utm=1", "token=2", "q=3"])
    expect(stripped).not.toContain(gone);
});

test("a session snapshot exports as HTML (one folder per window), honouring the strip option", async () => {
  // The strip option is remembered across cards and pages: set it explicitly.
  const strip = page
    .getByRole("region", { name: "Session snapshots" })
    .getByRole("checkbox", { name: "Strip query strings" });
  await strip.uncheck();
  const html = await downloadFrom("Session snapshots", /^Export HTML of the snapshot from /);
  expect(html).toContain("<!DOCTYPE NETSCAPE-Bookmark-file-1>");
  expect(html).toContain(`${BASE}/session-tab?s=1`);
  await strip.check();
  const stripped = await downloadFrom("Session snapshots", /^Export HTML of the snapshot from /);
  expect(stripped).toContain(`${BASE}/session-tab`);
  expect(stripped).not.toContain("s=1");
});
