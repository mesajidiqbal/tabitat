/**
 * Phase 5 accessibility e2e (docs/PHASE5.md §2): axe-core on every extension page, seeded with
 * data, in light and dark. Zero `serious` / `critical` violations; `moderate` / `minor` are
 * printed. Exclusions (`disableRules` / `exclude`) must carry their reason here: there are none.
 * Interaction states are audited too (a row menu open, an inline confirm open), and the keyboard
 * paths of the popup grid and the dashboard workspace cards are exercised.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { type LaunchedExtension, launchExtension } from "../support/extension";

test.describe.configure({ mode: "serial" });

const BASE = "http://127.0.0.1:9";
const SCHEMES = ["light", "dark"] as const;
type Scheme = (typeof SCHEMES)[number];

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
const readKey = (key: string) =>
  ext.worker.evaluate(async (k) => (await chrome.storage.local.get(k))[k], key);

/** Runs axe on `p`; prints every violation, fails on serious / critical ones. */
async function audit(p: Page, surface: string): Promise<void> {
  const { violations } = await new AxeBuilder({ page: p }).analyze();
  const count = (impact: string) => violations.filter((v) => v.impact === impact).length;
  const ids = violations.map((v) => `${v.impact}:${v.id}(${v.nodes.length})`).join(", ");
  console.log(
    `[a11y] ${surface}: critical ${count("critical")}, serious ${count("serious")}, moderate ${count("moderate")}, minor ${count("minor")}${ids ? ` -- ${ids}` : ""}`,
  );
  const blocking = violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => ({
      rule: v.id,
      impact: v.impact,
      help: v.help,
      nodes: v.nodes.slice(0, 5).map((n) => `${n.target.join(" ")} :: ${n.failureSummary ?? ""}`),
    }));
  expect(blocking, `${surface}: serious/critical axe violations`).toEqual([]);
}

/** Opens `path` in `scheme`, waits for `ready`, then audits it. */
async function visit(
  path: string,
  scheme: Scheme,
  surface: string,
  ready: (p: Page) => Promise<void>,
): Promise<void> {
  await page.emulateMedia({ colorScheme: scheme });
  await page.goto(extUrl(path));
  await ready(page);
  await audit(page, `${surface} (${scheme})`);
}

test.beforeAll(async () => {
  ext = await launchExtension();
  page = await ext.context.newPage();
  await page.goto(extUrl("recovery.html"));
  await expect.poll(async () => (await rpc("system.ping", {}))?.ok, { timeout: 15_000 }).toBe(true);
  // Seed only after the worker's first-run migration wrote `meta` (see export.spec.ts).
  await expect
    .poll(async () => (await readKey("meta")) !== undefined, { timeout: 15_000 })
    .toBe(true);

  // A second window with a tab group, driven by the popup / side panel via ?window=.
  w2 = await page.evaluate(async (base) => {
    const win = await chrome.windows.create({
      url: [`${base}/one`, `${base}/two`, `${base}/three`, `${base}/two`],
      focused: false,
    });
    const tabs = win?.tabs ?? [];
    const ids = tabs.slice(1, 3).flatMap((t) => (t.id === undefined ? [] : [t.id]));
    const groupId = await chrome.tabs.group({
      tabIds: ids as [number, ...number[]],
      createProperties: { windowId: win?.id ?? 0 },
    });
    await chrome.tabGroups.update(groupId, { title: "Research", color: "purple" });
    return win?.id ?? 0;
  }, BASE);
  await expect
    .poll(async () => (await readKey(`windows:${w2}`)) !== undefined, { timeout: 15_000 })
    .toBe(true);

  const now = Date.now();
  const ws = (id: string, name: string, color: string, n: number, links: number) => ({
    [`ws:meta:${id}`]: {
      id,
      name,
      color,
      kind: "named",
      resources: Array.from({ length: links }, (_, i) => ({
        id: `${id}-l${i}`,
        url: `${BASE}/${id}-link-${i}`,
        title: `${name} link ${i}`,
        order: i,
        addedAt: now,
      })),
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
      updatedAt: now - 3_600_000,
      rev: 1,
    },
  });
  const settings = (await readKey("settings")) as Record<string, unknown> & {
    dashboard: Record<string, unknown>;
    rev: number;
  };
  const records = {
    ...ws("alpha", "Alpha", "blue", 2, 2),
    ...ws("beta", "Beta", "green", 3, 0),
    settings: {
      ...settings,
      dashboard: {
        ...settings.dashboard,
        widgets: ["clock", "search", "quicklinks", "workspaces", "todos", "notes", "pomodoro"],
      },
      rev: settings.rev + 1,
    },
    quicklinks: {
      rev: 1,
      items: [
        { id: "q1", url: `${BASE}/docs`, title: "Team Docs", order: 0 },
        { id: "q2", url: `${BASE}/mail`, title: "Webmail", order: 1 },
      ],
    },
    "todos:global": {
      rev: 1,
      items: [
        { id: "t1", text: "Write the report", done: false, order: 0, createdAt: now },
        { id: "t2", text: "Ship it", done: true, order: 1, createdAt: now, doneAt: now },
      ],
    },
    "notes:global": { content: "# Notes\n\nSome **bold** text.", updatedAt: now, rev: 1 },
    recentlyClosed: [
      { id: "c1", url: `${BASE}/closed-1`, title: "Closed one", closedAt: now - 60_000 },
      { id: "c2", url: `${BASE}/closed-2`, title: "Closed two", closedAt: now - 120_000 },
    ],
    trash: {
      items: [
        {
          id: "tr1",
          kind: "link",
          deletedAt: now - 1_000,
          workspaceId: "alpha",
          link: { id: "x1", url: `${BASE}/gone`, title: "Gone link", order: 9, addedAt: now },
        },
      ],
    },
    "corrupt:ws:meta:zzz": { key: "ws:meta:zzz", raw: 1, error: "bad", at: now },
  };
  await ext.worker.evaluate(async (recs) => {
    const idx =
      ((await chrome.storage.local.get("ws:index"))["ws:index"] as string[] | undefined) ?? [];
    await chrome.storage.local.set({ ...recs, "ws:index": [...idx, "alpha", "beta"] });
  }, records);
  expect((await rpc("session.snapshotNow", {})).ok).toBe(true);
});

test.afterAll(async () => {
  await ext?.close();
});

for (const scheme of SCHEMES) {
  test(`popup (${scheme})`, async () => {
    await visit(`popup.html?window=${w2}`, scheme, "popup", async (p) => {
      await expect(p.locator("#ws-list").getByText("Alpha")).toBeVisible();
      await expect(p.getByText("Research")).toBeVisible();
      await expect(p.getByText("Closed one")).toBeVisible();
    });
  });

  test(`popup search results (${scheme})`, async () => {
    await visit(`popup.html?window=${w2}`, scheme, "popup search", async (p) => {
      await p.getByRole("combobox", { name: /Search/ }).fill("alpha");
      await expect(p.locator("#search-results [role=option]").first()).toBeVisible();
    });
    await page.getByRole("combobox", { name: /Search/ }).fill("zzzzqqq");
    await expect(page.locator("#search-results[role=status]")).toBeVisible();
    await audit(page, `popup search empty (${scheme})`);
  });

  test(`side panel (${scheme})`, async () => {
    await visit(`sidepanel.html?window=${w2}`, scheme, "side panel", async (p) => {
      await expect(p.locator("#ws-list").getByText("Alpha")).toBeVisible();
      await expect(p.getByText("Research")).toBeVisible();
    });
  });

  test(`dashboard (${scheme})`, async () => {
    await visit("dashboard.html", scheme, "dashboard", async (p) => {
      await expect(p.getByRole("link", { name: "Team Docs" })).toBeVisible();
      await expect(p.getByText("Write the report")).toBeVisible();
      await expect(p.getByTestId("pomodoro-status")).toBeAttached();
    });
  });

  test(`options, every section (${scheme})`, async () => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(extUrl("options.html"));
    const nav = page.getByRole("navigation");
    await expect(nav.getByRole("link").first()).toBeVisible();
    const names = await nav.getByRole("link").allInnerTexts();
    expect(names.length).toBeGreaterThan(5);
    for (const name of names) {
      await nav.getByRole("link", { name, exact: true }).click();
      await expect(page.getByRole("heading", { level: 2, name })).toBeVisible();
      await audit(page, `options #${name} (${scheme})`);
    }
  });

  test(`recovery (${scheme})`, async () => {
    await visit("recovery.html", scheme, "recovery", async (p) => {
      await expect(p.getByTestId("generation").first()).toBeVisible();
      await expect(p.getByRole("heading", { name: /Quarantined records/ })).toBeVisible();
    });
  });

  test(`suspended page (${scheme})`, async () => {
    const hash = new URLSearchParams({
      u: `${BASE}/sleeping?q=1`,
      t: "A sleeping tab",
      w: "alpha",
      s: "alpha-0",
    });
    // The placeholder loads its target as soon as it is visible: keep this page "hidden".
    const p = await ext.context.newPage();
    await p.addInitScript(() =>
      Object.defineProperty(document, "visibilityState", { get: () => "hidden" }),
    );
    await p.emulateMedia({ colorScheme: scheme });
    await p.goto(extUrl(`suspended.html#${hash}`));
    await expect(p.getByRole("heading", { name: "A sleeping tab" })).toBeVisible();
    await audit(p, `suspended (${scheme})`);
    await p.close();
  });

  test(`popup with a row menu open (${scheme})`, async () => {
    await visit(`popup.html?window=${w2}`, scheme, "popup", async (p) => {
      await expect(p.locator("#ws-list").getByText("Alpha")).toBeVisible();
    });
    await page.locator("#ws-list").getByRole("button", { name: "Actions for Alpha" }).click();
    const menu = page.getByRole("menu", { name: "Actions for Alpha" });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitem").first()).toBeFocused();
    await audit(page, `popup row menu open (${scheme})`);
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
  });

  test(`options Data with the confirm open (${scheme})`, async () => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(extUrl("options.html"));
    await page.getByRole("navigation").getByRole("link", { name: "Data", exact: true }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Data" })).toBeVisible();
    const empty = page.getByRole("button", { name: "Empty trash" });
    await expect(empty).toBeEnabled();
    await empty.click();
    const group = page.getByRole("group", { name: /Permanently delete 1 items in the trash/ });
    await expect(group).toBeVisible();
    await expect(group.getByRole("button", { name: "Cancel" })).toBeFocused();
    await audit(page, `options Data confirm open (${scheme})`);
    await page.keyboard.press("Escape");
    await expect(group).toBeHidden();
    await expect(empty).toBeFocused();
  });

  test(`onboarding (${scheme})`, async () => {
    await visit("onboarding.html", scheme, "onboarding", async (p) => {
      await expect(p.getByRole("heading").first()).toBeVisible();
    });
  });
}

test("grid keyboard in the popup: cells, actions, rows; focus ring on the row", async () => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto(extUrl(`popup.html?window=${w2}`));
  const grid = page.getByRole("grid", { name: /Tabs in this window/ });
  // 4 tabs + the "Research" group header row.
  await expect(grid).toHaveAttribute("aria-rowcount", "5");
  await expect(grid.getByRole("row")).toHaveCount(5);
  const first = grid.getByRole("row").first();
  const cell = first.getByRole("gridcell").first();
  await cell.focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowUp");
  await expect(cell).toBeFocused();
  // The ring is drawn around the row while its primary cell has keyboard focus.
  expect(await first.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe("solid");
  await page.keyboard.press("ArrowRight");
  const close = first.getByRole("button", { name: "Close tab" });
  await expect(close).toBeFocused();
  await expect(close).toBeVisible();
  expect(await close.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe("solid");
  await page.keyboard.press("ArrowRight");
  await expect(close).not.toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(close).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(cell).toBeFocused();
  // Down from an action: the next row is the group header (one cell holding its button).
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowDown");
  await expect(grid.getByRole("button", { name: /Research/ })).toBeFocused();
  await page.keyboard.press("End");
  await expect(grid.getByRole("row").last().getByRole("gridcell").first()).toBeFocused();
});

test("dashboard workspace cards: arrows move in two dimensions; Shift+F10 menu (C3.3)", async () => {
  // Runs last: it adds workspaces the audits above do not expect.
  const now = Date.now();
  const extra = ["gamma", "delta", "epsilon", "zeta"];
  await ext.worker.evaluate(
    async ({ ids, now }) => {
      const recs: Record<string, unknown> = {};
      for (const id of ids) {
        recs[`ws:meta:${id}`] = {
          id,
          name: id[0]?.toUpperCase() + id.slice(1),
          color: "cyan",
          kind: "named",
          resources: [],
          createdAt: now,
          updatedAt: now,
          rev: 1,
        };
        recs[`ws:tabs:${id}`] = { tabs: [], updatedAt: now, rev: 1 };
      }
      const idx =
        ((await chrome.storage.local.get("ws:index"))["ws:index"] as string[] | undefined) ?? [];
      await chrome.storage.local.set({ ...recs, "ws:index": [...idx, ...ids] });
    },
    { ids: extra, now },
  );
  // One widget column at this width: the workspaces card is wide enough for several card columns.
  await page.setViewportSize({ width: 680, height: 1000 });
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto(extUrl("dashboard.html"));
  const grid = page.locator("#dash-ws-list");
  await expect(grid.getByText("Zeta")).toBeVisible();
  const rows = grid.getByRole("row");
  const layout = await grid.evaluate((el) => {
    const tops = [...el.querySelectorAll<HTMLElement>(':scope > [role="row"]')].map(
      (r) => r.offsetTop,
    );
    return { count: tops.length, cols: tops.filter((t) => t === tops[0]).length };
  });
  expect(layout.cols, "cards per row").toBeGreaterThanOrEqual(2);
  expect(layout.count, "a second row of cards").toBeGreaterThan(layout.cols);
  const cell = (i: number) => rows.nth(i).getByRole("gridcell").first();

  await cell(0).focus();
  await page.keyboard.press("ArrowRight");
  await expect(cell(1)).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(cell(0)).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(cell(layout.cols)).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(cell(0)).toBeFocused();
  // Right never enters the actions cell of a card; the menu opens from the keyboard instead.
  await page.keyboard.press("ArrowRight");
  await expect(cell(1)).toBeFocused();
  await page.keyboard.press("Shift+F10");
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem").first()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(cell(1)).toBeFocused();
  // Nothing was switched or opened by the keys above.
  await expect(page).toHaveURL(/dashboard\.html$/);
});
