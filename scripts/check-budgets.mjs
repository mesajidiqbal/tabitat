// Perf CI gate (docs/PHASE4.md §5, ARCHITECTURE §9): gzip sizes of each surface's JS/CSS in a
// built extension directory. A surface's JS = the scripts and modulepreloads its HTML references
// plus every chunk they statically import (transitively); dynamic `import()` chunks are lazy and
// not counted per surface. Budgets apply to JS only; "total" = every .js file in the build.
//
//   node scripts/check-budgets.mjs [--dir .output/chrome-mv3] [--json]
//
// Exits 1 when a surface (or the total) is over budget or a surface is missing.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

const KB = 1024;

/** JS budgets in gzip bytes. */
export const DEFAULT_BUDGETS = {
  surfaces: {
    popup: 40 * KB,
    sidepanel: 50 * KB,
    dashboard: 60 * KB,
    options: 60 * KB,
    recovery: 40 * KB,
    suspended: 10 * KB,
    onboarding: 15 * KB,
    background: 60 * KB,
  },
  totalJs: 200 * KB,
};

/** Surfaces and their entry file (HTML page, or the worker script). */
export const SURFACES = [
  { name: "popup", entry: "popup.html" },
  { name: "sidepanel", entry: "sidepanel.html" },
  { name: "dashboard", entry: "dashboard.html" },
  { name: "options", entry: "options.html" },
  { name: "recovery", entry: "recovery.html" },
  { name: "suspended", entry: "suspended.html" },
  { name: "onboarding", entry: "onboarding.html" },
  { name: "background", entry: "background.js" },
];

const attr = (tag, name) => {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return m ? (m[1] ?? m[2] ?? m[3] ?? null) : null;
};

/** Resolves a reference from `fromFile` against the build root ("/x" = root-relative). */
function resolveRef(root, fromFile, ref) {
  const clean = ref.split(/[?#]/)[0];
  if (!clean || /^[a-z][a-z0-9+.-]*:/i.test(clean) || clean.startsWith("//")) return null;
  const abs = clean.startsWith("/")
    ? join(root, clean.slice(1))
    : resolve(dirname(fromFile), clean);
  const rel = relative(root, abs);
  if (rel.startsWith("..") || rel === "") return null; // outside the build
  return abs;
}

const isFile = (p) => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

/** `<script src>` (JS), `<link rel=modulepreload href>` (JS), `<link rel=stylesheet href>` (CSS). */
export function htmlRefs(html) {
  const js = [];
  const css = [];
  for (const m of html.matchAll(/<script\b[^>]*>/gi)) {
    const src = attr(m[0], "src");
    if (src) js.push(src);
  }
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const rel = (attr(m[0], "rel") ?? "").toLowerCase().split(/\s+/);
    const href = attr(m[0], "href");
    if (!href) continue;
    if (rel.includes("stylesheet")) css.push(href);
    else if (rel.includes("modulepreload")) js.push(href);
  }
  return { js, css };
}

/**
 * Static import specifiers of an ES module (`import "./x.js"`, `import x from "./x.js"`,
 * `export * from "./x.js"`), minified or not; `?query` / `#hash` suffixes are stripped. Only
 * statements count: the keyword must start the file or follow `;`, `{`, `}` or a newline, so a
 * `from "./x.js"` inside a string literal is not an import. Dynamic `import("./x.js")` is
 * excluded.
 */
export function staticImports(code) {
  const out = new Set();
  const re =
    /(?:^|[;{}\n])\s*(?:import|export)\s*(?:[^;"'`()]*?\bfrom\s*)?(["'])([^"'\n]+?\.m?js(?:[?#][^"'\n]*)?)\1/g;
  for (const m of code.matchAll(re)) out.add(m[2].split(/[?#]/)[0]);
  return [...out];
}

/** Local references (relative or root-relative) are ours to resolve; URLs and bare names are not. */
const isLocalRef = (ref) => /^\.{0,2}\//.test(ref.split(/[?#]/)[0]);

/**
 * Files of one surface: entry refs plus their static JS graph. Paths are absolute. `unresolved`
 * lists local references (`from -> ref`, build-relative) that name no file in the build.
 */
export function surfaceFiles(root, entry) {
  const entryPath = join(root, entry);
  if (!isFile(entryPath)) return null;
  const js = new Set();
  const css = new Set();
  const unresolved = [];
  const queue = [];
  const where = (file) => relative(root, file).split(sep).join("/");
  const follow = (from, ref, onFile, html = false) => {
    if (!html && !isLocalRef(ref)) return; // a bare module specifier is not ours
    const p = resolveRef(root, from, ref);
    if (p === null) return;
    if (isFile(p)) onFile(p);
    else unresolved.push(`${where(from)} -> ${ref}`);
  };
  if (entry.endsWith(".html")) {
    const refs = htmlRefs(readFileSync(entryPath, "utf8"));
    for (const r of refs.js) follow(entryPath, r, (p) => queue.push(p), true);
    for (const r of refs.css) follow(entryPath, r, (p) => css.add(p), true);
  } else {
    queue.push(entryPath);
  }
  while (queue.length > 0) {
    const file = queue.shift();
    if (js.has(file)) continue;
    js.add(file);
    for (const spec of staticImports(readFileSync(file, "utf8"))) {
      follow(file, spec, (p) => {
        if (!js.has(p)) queue.push(p);
      });
    }
  }
  return { js: [...js].sort(), css: [...css].sort(), unresolved: [...new Set(unresolved)].sort() };
}

/** Gzip size cache: each file is compressed once. */
export function gzipSizer() {
  const cache = new Map();
  return (file) => {
    let n = cache.get(file);
    if (n === undefined) {
      n = gzipSync(readFileSync(file), { level: 9 }).length;
      cache.set(file, n);
    }
    return n;
  };
}

function allJs(root) {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.m?js$/.test(name)) out.push(p);
    }
  };
  walk(root);
  return out.sort();
}

/**
 * Measures a build directory. Returns per-surface gzip sums (JS, CSS), the total of every JS
 * file, and whether everything is within budget.
 */
export function measureBudgets(root, budgets = DEFAULT_BUDGETS, surfaces = SURFACES) {
  const dir = resolve(root);
  const gz = gzipSizer();
  const rows = surfaces.map(({ name, entry }) => {
    const budget = budgets.surfaces[name] ?? null;
    const files = surfaceFiles(dir, entry);
    if (!files) {
      return {
        surface: name,
        missing: true,
        jsGz: 0,
        cssGz: 0,
        budget,
        ok: false,
        unresolved: [],
        files: [],
      };
    }
    const jsGz = files.js.reduce((n, f) => n + gz(f), 0);
    const cssGz = files.css.reduce((n, f) => n + gz(f), 0);
    return {
      surface: name,
      missing: false,
      jsGz,
      cssGz,
      budget,
      ok: files.unresolved.length === 0 && (budget === null || jsGz <= budget),
      unresolved: files.unresolved,
      files: [...files.js, ...files.css].map((f) => relative(dir, f).split(sep).join("/")),
    };
  });
  const totalFiles = allJs(dir);
  const totalJsGz = totalFiles.reduce((n, f) => n + gz(f), 0);
  const totalOk = totalJsGz <= budgets.totalJs;
  return {
    dir,
    surfaces: rows,
    total: { jsGz: totalJsGz, files: totalFiles.length, budget: budgets.totalJs, ok: totalOk },
    ok: totalOk && rows.every((r) => r.ok),
  };
}

const kb = (n) => `${(n / KB).toFixed(1)} KB`;

export function formatTable(result) {
  const head = ["surface", "JS gz", "CSS gz", "budget", "status"];
  const body = result.surfaces.map((r) => [
    r.surface,
    r.missing ? "-" : kb(r.jsGz),
    r.missing ? "-" : kb(r.cssGz),
    r.budget === null ? "-" : kb(r.budget),
    r.missing ? "MISSING" : r.unresolved.length > 0 ? "UNRESOLVED" : r.ok ? "ok" : "OVER",
  ]);
  body.push([
    `total JS (${result.total.files} files)`,
    kb(result.total.jsGz),
    "",
    kb(result.total.budget),
    result.total.ok ? "ok" : "OVER",
  ]);
  const widths = head.map((h, i) => Math.max(h.length, ...body.map((r) => r[i].length)));
  const line = (cells) =>
    cells.map((c, i) => (i === 0 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join("  ");
  return [line(head), widths.map((w) => "-".repeat(w)).join("  "), ...body.map(line)].join("\n");
}

function main(argv) {
  let dir = ".output/chrome-mv3";
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") json = true;
    else if (a === "--dir") dir = argv[++i] ?? dir;
    else if (a.startsWith("--dir=")) dir = a.slice("--dir=".length);
    else {
      console.error(`unknown argument: ${a}`);
      return 2;
    }
  }
  if (!isFile(join(dir, "manifest.json"))) {
    console.error(`no build in ${dir} (manifest.json missing); run the build first`);
    return 1;
  }
  const result = measureBudgets(dir);
  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`bundle budgets (gzip) for ${relative(process.cwd(), result.dir) || "."}`);
    console.log(formatTable(result));
    for (const r of result.surfaces) {
      for (const u of r.unresolved) {
        console.error(`unresolved chunk reference in ${r.surface}: ${u} (file not in the build)`);
      }
    }
    console.log(result.ok ? "budgets ok" : "budgets FAILED");
  }
  return result.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
