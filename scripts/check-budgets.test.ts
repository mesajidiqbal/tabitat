import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import {
  formatTable,
  htmlRefs,
  measureBudgets,
  staticImports,
  surfaceFiles,
} from "./check-budgets.mjs";

let dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "tabitat-budgets-"));
  dirs.push(root);
  for (const [p, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), content);
  }
  return root;
}

const gz = (s: string) => gzipSync(Buffer.from(s), { level: 9 }).length;

// Minified Vite-style output: a page entry, a shared chunk graph, a lazy chunk.
const FILES = {
  "manifest.json": "{}",
  "popup.html": `<!DOCTYPE html><html><head>
    <script type="module" crossorigin src="/chunks/popup-a.js"></script>
    <link rel="modulepreload" crossorigin href="/chunks/shared-b.js">
    <link rel="stylesheet" crossorigin href="/assets/popup-c.css">
    <link rel="icon" href="/icon/16.png">
  </head><body></body></html>`,
  "options.html": `<script type="module" src="./chunks/options-d.js"></script>`,
  "chunks/popup-a.js": `import{a as x}from"./shared-b.js";import"./side-e.js";const l=()=>import("./lazy-f.js");x(l);`,
  "chunks/shared-b.js": `export*from"./deep-g.js";export const a=1;`,
  "chunks/deep-g.js": "export const g=2;",
  "chunks/side-e.js": "console.log(1);",
  "chunks/lazy-f.js": "export default 3;",
  "chunks/options-d.js": `import { a } from './shared-b.js';\nexport { a };`,
  "assets/popup-c.css": "body{color:red}",
  "background.js": "(function(){})();",
};

describe("check-budgets", () => {
  it("parses HTML refs and static imports (not dynamic ones)", () => {
    expect(htmlRefs(FILES["popup.html"])).toEqual({
      js: ["/chunks/popup-a.js", "/chunks/shared-b.js"],
      css: ["/assets/popup-c.css"],
    });
    expect(staticImports(FILES["chunks/popup-a.js"]).sort()).toEqual([
      "./shared-b.js",
      "./side-e.js",
    ]);
    expect(staticImports(FILES["chunks/shared-b.js"])).toEqual(["./deep-g.js"]);
    expect(staticImports(FILES["chunks/options-d.js"])).toEqual(["./shared-b.js"]);
  });

  it("follows the static graph transitively, once per file", () => {
    const root = fixture(FILES);
    const files = surfaceFiles(root, "popup.html");
    const rel = (xs: string[]) => xs.map((f) => f.slice(root.length + 1)).sort();
    expect(rel(files?.js ?? [])).toEqual([
      "chunks/deep-g.js",
      "chunks/popup-a.js",
      "chunks/shared-b.js",
      "chunks/side-e.js",
    ]);
    expect(rel(files?.css ?? [])).toEqual(["assets/popup-c.css"]);
    expect(rel(surfaceFiles(root, "options.html")?.js ?? [])).toEqual([
      "chunks/deep-g.js",
      "chunks/options-d.js",
      "chunks/shared-b.js",
    ]);
    expect(surfaceFiles(root, "nope.html")).toBeNull();
  });

  it("sums gzip sizes per surface and checks budgets", () => {
    const root = fixture(FILES);
    const popupJs = [
      "chunks/popup-a.js",
      "chunks/shared-b.js",
      "chunks/deep-g.js",
      "chunks/side-e.js",
    ]
      .map((k) => gz(FILES[k as keyof typeof FILES]))
      .reduce((a, b) => a + b, 0);
    const allJs = Object.entries(FILES)
      .filter(([k]) => k.endsWith(".js"))
      .reduce((n, [, v]) => n + gz(v), 0);
    const surfaces = [
      { name: "popup", entry: "popup.html" },
      { name: "options", entry: "options.html" },
      { name: "background", entry: "background.js" },
    ];
    const roomy = {
      surfaces: { popup: 10_000, options: 10_000, background: 10_000 },
      totalJs: 10_000,
    };
    const r = measureBudgets(root, roomy, surfaces);
    expect(r.ok).toBe(true);
    const popup = r.surfaces.find((s) => s.surface === "popup");
    expect(popup?.jsGz).toBe(popupJs);
    expect(popup?.cssGz).toBe(gz(FILES["assets/popup-c.css"]));
    expect(r.surfaces.find((s) => s.surface === "background")?.jsGz).toBe(
      gz(FILES["background.js"]),
    );
    // the total counts every JS file, lazy chunks included
    expect(r.total).toMatchObject({ jsGz: allJs, files: 7, ok: true });

    const tight = measureBudgets(
      root,
      { ...roomy, surfaces: { ...roomy.surfaces, popup: popupJs - 1 } },
      surfaces,
    );
    expect(tight.ok).toBe(false);
    expect(tight.surfaces.find((s) => s.surface === "popup")?.ok).toBe(false);
    expect(formatTable(tight)).toMatch(/popup.*OVER/);

    const overTotal = measureBudgets(root, { ...roomy, totalJs: allJs - 1 }, surfaces);
    expect(overTotal.ok).toBe(false);
    expect(overTotal.total.ok).toBe(false);
  });

  it("a missing surface fails", () => {
    const root = fixture({ "manifest.json": "{}", "background.js": "1" });
    const r = measureBudgets(root, { surfaces: { popup: 1000 }, totalJs: 1000 }, [
      { name: "popup", entry: "popup.html" },
    ]);
    expect(r.ok).toBe(false);
    expect(r.surfaces[0]).toMatchObject({ surface: "popup", missing: true, ok: false });
    expect(formatTable(r)).toMatch(/MISSING/);
  });
});
