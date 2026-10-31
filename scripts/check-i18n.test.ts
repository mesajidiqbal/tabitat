import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkI18n, formatReport, messageUsage, scanSource } from "./check-i18n.mjs";

let dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

function fixture(files: Record<string, unknown>): string {
  const root = mkdtempSync(join(tmpdir(), "tabitat-i18n-"));
  dirs.push(root);
  for (const [p, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(
      join(root, p),
      typeof content === "string" ? content : JSON.stringify(content, null, 2),
    );
  }
  return root;
}

const m = (message: string, placeholders?: Record<string, string>) => ({
  message,
  ...(placeholders
    ? {
        placeholders: Object.fromEntries(
          Object.entries(placeholders).map(([k, v]) => [k, { content: v }]),
        ),
      }
    : {}),
});

const EN = "public/_locales/en/messages.json";
const FAMILIES = [{ prefix: "color_", why: "swatches" }];

// A small clean project: every reference style the checker supports.
const CLEAN = {
  [EN]: {
    appName: m("App"),
    cancel: m("Cancel"),
    tabCount: m("$1 tabs"),
    tabOne: m("1 tab"),
    greeting: m("Hello $NAME$", { name: "$1" }),
    errBusy: m("Busy"),
    exportTitle: m("Export"),
    color_red: m("Red"),
    color_blue: m("Blue"),
    stage_done: m("Done"),
    range: m("Between $1 and $2"),
  },
  "wxt.config.ts": 'export default { name: "__MSG_appName__" };\n',
  "src/a.tsx": [
    'import { t, plural } from "@/i18n";',
    '// t("commentedOut") is ignored',
    'const ERR = { busy: "errBusy" } as const;',
    'const LABELS = ["exportTitle"];',
    "export const A = (n: number, c: string, s: string, k: keyof typeof ERR) => (",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: source text under test
    "  <p title={t(`color_${c}`)}>",
    '    {t("cancel")} {plural(n, "tabOne", "tabCount")} {t("greeting", s)}',
    '    {t(ERR[k])} {LABELS.map((l) => chrome.i18n.getMessage(l))} {t("range", [1, 2])}',
    '    {t(n > 1 ? `stage_done` : "cancel")} don\'t',
    "  </p>",
    ");",
  ].join("\n"),
  // Tests and test helpers are not scanned.
  "src/a.test.ts": 't("onlyInTests"); t("nope");',
  "src/testing/helper.ts": 't("nope");',
};

describe("check-i18n", () => {
  it("passes a project that references every key correctly", () => {
    const r = checkI18n(fixture(CLEAN), { families: FAMILIES });
    expect(r.problems).toEqual({
      unused: [],
      missing: [],
      placeholders: [],
      families: [],
      locales: [],
    });
    expect(r.ok).toBe(true);
    expect(r.families[0]).toMatchObject({ prefix: "color_", keys: 2 });
    expect(formatReport(r)).toMatch(/i18n ok$/);
  });

  it("reports unused keys; lower-case keys only count through a direct call", () => {
    const root = fixture({
      ...CLEAN,
      [EN]: { ...CLEAN[EN], orphanKey: m("x"), pinned: m("Pinned") },
      "src/b.ts": 'export const state = "pinned";\n',
    });
    const r = checkI18n(root, { families: FAMILIES });
    expect(r.ok).toBe(false);
    expect(r.problems.unused).toEqual(["orphanKey", "pinned"]);
  });

  it("reports missing keys from t(), getMessage(), plural() and __MSG__", () => {
    const root = fixture({
      ...CLEAN,
      "src/b.ts": [
        'import { t, plural } from "@/i18n";',
        't("nope");',
        'chrome.i18n.getMessage("gone");',
        'plural(2, "tabOne", "tabsMany");',
      ].join("\n"),
      "src/page.html": "<title>__MSG_noTitle__</title><p>__MSG_@@extension_id__</p>",
    });
    const r = checkI18n(root, { families: FAMILIES });
    expect(r.problems.missing).toEqual([
      { key: "nope", at: "src/b.ts:2", via: "t()" },
      { key: "gone", at: "src/b.ts:3", via: "getMessage()" },
      { key: "tabsMany", at: "src/b.ts:4", via: "plural()" },
      { key: "noTitle", at: "src/page.html:1", via: "__MSG__" },
    ]);
  });

  it("reports placeholder mismatches in messages and at call sites", () => {
    const root = fixture({
      ...CLEAN,
      [EN]: {
        ...CLEAN[EN],
        undeclared: m("Hi $WHO$"),
        unusedPh: m("Hi", { who: "$1" }),
        needsTwo: m("$1 of $2"),
        needsNone: m("Plain"),
      },
      "src/b.ts": [
        'import { t } from "@/i18n";',
        't("undeclared", "x"); t("unusedPh");',
        't("needsTwo", [1]);',
        't("needsNone", "x");',
        't("tabCount");',
        't("range", [1, 2, 3]);',
      ].join("\n"),
    });
    const r = checkI18n(root, { families: FAMILIES });
    expect(r.problems.placeholders).toEqual([
      'undeclared: uses $WHO$ but declares no placeholder "who"',
      'unusedPh: placeholder "who" is declared but the message never uses it',
      'src/b.ts:2 t("undeclared") passes substitutions; the message uses none',
      'src/b.ts:3 t("needsTwo") passes 1 substitution(s); the message uses up to $2',
      'src/b.ts:4 t("needsNone") passes substitutions; the message uses none',
      'src/b.ts:5 t("tabCount") passes no substitutions; the message uses $1',
      'src/b.ts:6 t("range") passes 3 substitution(s); the message uses up to $2',
    ]);
  });

  it("counts a string, plain template or number argument as exactly one substitution", () => {
    const root = fixture({
      ...CLEAN,
      [EN]: { ...CLEAN[EN], needsTwo: m("$1 of $2"), one: m("Just $1"), plain: m("Plain") },
      "src/b.ts": [
        'import { t } from "@/i18n";',
        't("needsTwo", "x");',
        't("needsTwo", `x`);',
        't("needsTwo", 5);',
        't("plain", "x");',
        't("one", "x"); t("one", `x`); t("one", 5);',
        // identifiers, calls and expressions stay "some" (not reported)
        't("needsTwo", name); t("needsTwo", f(1)); t("needsTwo", a + b);',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: source text under test
        't("needsTwo", `x${y}`);',
      ].join("\n"),
    });
    const r = checkI18n(root, { families: FAMILIES });
    expect(r.problems.placeholders).toEqual([
      'src/b.ts:2 t("needsTwo") passes 1 substitution(s); the message uses up to $2',
      'src/b.ts:3 t("needsTwo") passes 1 substitution(s); the message uses up to $2',
      'src/b.ts:4 t("needsTwo") passes 1 substitution(s); the message uses up to $2',
      'src/b.ts:5 t("plain") passes substitutions; the message uses none',
    ]);
  });

  it("requires dynamic keys to belong to a declared family that is still built", () => {
    const root = fixture({
      ...CLEAN,
      // biome-ignore lint/suspicious/noTemplateCurlyInString: source text under test
      "src/b.ts": 'import { t } from "@/i18n";\nexport const f = (k: string) => t(`kind_${k}`);\n',
    });
    const undeclared = checkI18n(root, { families: FAMILIES });
    expect(undeclared.problems.families).toEqual([
      // biome-ignore lint/suspicious/noTemplateCurlyInString: source text under test
      "src/b.ts:2 builds a key from `kind_${…}`: declare the family in DYNAMIC_FAMILIES",
    ]);
    const stale = checkI18n(fixture({ ...CLEAN, "src/a.tsx": "export {};\n" }), {
      families: FAMILIES,
    });
    expect(stale.problems.families).toEqual([
      'family "color_*" is declared but no source builds it',
    ]);
    // Keys of a stale family are not covered.
    expect(stale.problems.unused).toContain("color_red");
  });

  it("checks other locales against the default one", () => {
    const root = fixture({
      ...CLEAN,
      "public/_locales/de/messages.json": {
        cancel: m("Abbrechen"),
        tabCount: m("Tabs"),
        extra: m("x"),
      },
    });
    const r = checkI18n(root, { families: FAMILIES });
    expect(r.locales).toEqual(["de", "en"]);
    expect(r.problems.locales).toEqual([
      'de: "tabCount" placeholders differ from en',
      'de: "extra" is not in en',
    ]);
  });

  it("CLI: exit code and --json", () => {
    const root = fixture({ ...CLEAN, [EN]: { ...CLEAN[EN], orphanKey: m("x") } });
    const script = join(__dirname, "check-i18n.mjs");
    const text = spawnSync(process.execPath, [script, "--root", root], { encoding: "utf8" });
    expect(text.status).toBe(1);
    expect(text.stdout).toContain("unused keys");
    expect(text.stdout).toContain("orphanKey");
    const json = spawnSync(process.execPath, [script, "--root", root, "--json"], {
      encoding: "utf8",
    });
    expect(JSON.parse(json.stdout).problems.unused).toEqual(["orphanKey"]);
  });
});

describe("scanner details", () => {
  it("handles optional calls, regex literals, JSX apostrophes and template expressions", () => {
    const src = [
      'const re = /["\'`]t\\("fake"\\)/g;',
      'runtime.getMessage?.("optional");',
      // biome-ignore lint/suspicious/noTemplateCurlyInString: source text under test
      'const s = `${t("inTemplate")} and ${`nested ${t("deep")}`}`;',
      'const j = <p>it\'s {t("afterJsx")}</p>;',
      "function t(key: string) { return key; }",
    ].join("\n");
    const keys = scanSource(src, "x.tsx").calls.map((c) => c.key);
    expect(keys).toEqual(["optional", "inTemplate", "deep", "afterJsx"]);
  });

  it("messageUsage follows chrome.i18n: $$ is a literal dollar, names are case-insensitive", () => {
    expect(messageUsage(m("Costs $$1 for $Item$", { item: "$2" }))).toEqual({
      named: ["item"],
      maxIndex: 2,
      undeclared: [],
      unusedPlaceholders: [],
    });
  });
});
