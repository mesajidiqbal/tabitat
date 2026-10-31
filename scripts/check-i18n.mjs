// i18n readiness gate (docs/PHASE5.md §3, docs/I18N.md). Compares public/_locales/<lang>/
// messages.json with the source tree and fails on:
//   - unused keys: a message no source references;
//   - missing keys: `t("x")` / `plural(n, "a", "b")` / `getMessage("x")` / `__MSG_x__` with no
//     entry in the default locale;
//   - placeholder mismatches: `$NAME$` in a message without a declared placeholder, a declared
//     placeholder the message never uses, and call sites whose substitutions do not match the
//     `$1..$9` the message uses (passed but unused, or used but not passed);
//   - other locales: keys that are not in the default locale, or placeholders that differ.
//
// How a key counts as referenced (tests and test helpers are never scanned):
//   1. direct calls: the key argument of `t`, `plural`, `getMessage` and the suspended page's
//      `msg` wrapper (every string literal in it, so `t(c ? "a" : "b")` counts both);
//   2. `__MSG_key__` anywhere in a scanned file (wxt.config.ts manifest, HTML);
//   3. key literals: a string literal anywhere in the scanned code that equals a key and looks
//      like one (contains an upper-case letter or `_`). This covers keys kept in constant maps or
//      arrays and handed to `t`/`getMessage` later (`EXPORT_LABEL_KEYS`, `err_*` in ui/errors,
//      `stage_*` / `reason_*` in recovery, `optBmWarn_*`, `kind*`, the dashboard greetings,
//      option section labels). Plain lower-case keys ("cancel", "pinned") collide with ordinary
//      strings, so they only count through a direct call;
//   4. dynamic families (DYNAMIC_FAMILIES below): keys built with a template literal. Each
//      family must still be built somewhere (`t(\`color_${c}\`)`), or the check fails, and a
//      template-built key whose prefix is not declared fails too.
//
//   node scripts/check-i18n.mjs [--root .] [--json]
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";

/** Keys built at runtime from a template literal. Keep each entry justified. */
export const DYNAMIC_FAMILIES = [
  {
    prefix: "color_",
    why: "ui/components/ColorSwatches.tsx: t() of `color_` + the workspace colour, for every colour",
  },
];

/** Functions whose key argument(s) are message keys, and where substitutions go. */
const CALLEES = {
  t: { keys: [0], subs: 1 },
  getMessage: { keys: [0], subs: 1 },
  // src/entrypoints/suspended/main.ts: framework-free page, local chrome.i18n wrapper.
  msg: { keys: [0], subs: 1 },
  // plural(n, one, many): n is always passed as $1.
  plural: { keys: [1, 2], subs: "plural" },
};

export const DEFAULT_OPTIONS = {
  localesDir: "public/_locales",
  defaultLocale: "en",
  sources: ["src", "wxt.config.ts"],
  families: DYNAMIC_FAMILIES,
};

const CODE_EXT = /\.(ts|tsx|mts|js|mjs)$/;
const isTestFile = (rel) =>
  /\.(test|spec)\.[cm]?[jt]sx?$/.test(rel) || /(^|\/)(testing|__tests__|__mocks__)\//.test(rel);

// ------------------------------------------------------------------------------- tokenizer

const REGEX_AFTER_WORD = new Set([
  "return",
  "typeof",
  "case",
  "in",
  "of",
  "new",
  "delete",
  "void",
  "throw",
  "else",
  "do",
  "yield",
  "await",
]);

/**
 * A small JS/TS tokenizer: string literals (with their value), template literals (static text
 * before the first `${`, and whether there is an expression), identifiers and punctuation.
 * Comments and regex literals are skipped. A quote that reaches the end of its line is treated
 * as punctuation (JSX text such as `don't`), so one odd line cannot swallow the file.
 */
export function tokenize(src) {
  const toks = [];
  const n = src.length;
  let i = 0;
  let braces = 0;
  const tplDepth = []; // brace depth at which each open template expression ends
  let last = null;
  const push = (tok) => {
    toks.push(tok);
    last = tok;
  };
  const readChunk = (j) => {
    let text = "";
    while (j < n) {
      const c = src[j];
      if (c === "\\") {
        text += src.slice(j, j + 2);
        j += 2;
      } else if (c === "`") {
        return { text, expr: false, next: j + 1 };
      } else if (c === "$" && src[j + 1] === "{") {
        return { text, expr: true, next: j + 2 };
      } else {
        text += c;
        j++;
      }
    }
    return { text, expr: false, next: n };
  };
  const regexAllowed = () => {
    if (last === null) return true;
    if (last.type === "punct") return !/[)\]}]/.test(last.value);
    if (last.type === "ident") return REGEX_AFTER_WORD.has(last.value);
    return false;
  };
  while (i < n) {
    const c = src[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      const e = src.indexOf("\n", i);
      i = e < 0 ? n : e;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const e = src.indexOf("*/", i + 2);
      i = e < 0 ? n : e + 2;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      let value = "";
      let ok = false;
      while (j < n) {
        const d = src[j];
        if (d === "\\") {
          value += src[j + 1] ?? "";
          j += 2;
        } else if (d === c) {
          ok = true;
          break;
        } else if (d === "\n") {
          break;
        } else {
          value += d;
          j++;
        }
      }
      if (ok) {
        push({ type: "str", value, start: i });
        i = j + 1;
      } else {
        push({ type: "punct", value: c, start: i });
        i++;
      }
      continue;
    }
    if (c === "`") {
      const r = readChunk(i + 1);
      push({ type: "tpl", head: r.text, dynamic: r.expr, start: i });
      i = r.next;
      if (r.expr) tplDepth.push(braces);
      continue;
    }
    if (c === "}" && tplDepth.length > 0 && tplDepth[tplDepth.length - 1] === braces) {
      tplDepth.pop();
      const r = readChunk(i + 1);
      i = r.next;
      if (r.expr) tplDepth.push(braces);
      last = { type: "tplEnd" };
      continue;
    }
    if (c === "/" && regexAllowed()) {
      let j = i + 1;
      let cls = false;
      while (j < n && src[j] !== "\n") {
        const d = src[j];
        if (d === "\\") j++;
        else if (d === "[") cls = true;
        else if (d === "]") cls = false;
        else if (d === "/" && !cls) break;
        j++;
      }
      j++;
      while (j < n && /[a-z]/i.test(src[j])) j++;
      push({ type: "regex", start: i });
      i = j;
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i + 1;
      while (j < n && /[\w$]/.test(src[j])) j++;
      push({ type: "ident", value: src.slice(i, j), start: i });
      i = j;
      continue;
    }
    if (/[0-9]/.test(c)) {
      let j = i + 1;
      while (j < n && /[\w.]/.test(src[j])) j++;
      push({ type: "num", start: i });
      i = j;
      continue;
    }
    if (c === "{") braces++;
    else if (c === "}") braces--;
    push({ type: "punct", value: c, start: i });
    i++;
  }
  return toks;
}

const OPEN = new Set(["(", "[", "{"]);
const CLOSE = new Set([")", "]", "}"]);

/** Arguments of the call whose "(" is at toks[open]: token slices split at top-level commas. */
function callArgs(toks, open) {
  const args = [];
  let cur = [];
  let depth = 0;
  for (let k = open + 1; k < toks.length; k++) {
    const tok = toks[k];
    if (tok.type === "punct" && OPEN.has(tok.value)) depth++;
    if (tok.type === "punct" && CLOSE.has(tok.value)) {
      if (depth === 0) {
        if (cur.length > 0) args.push(cur);
        return args;
      }
      depth--;
    }
    if (depth === 0 && tok.type === "punct" && tok.value === ",") {
      args.push(cur);
      cur = [];
    } else {
      cur.push(tok);
    }
  }
  return args;
}

/**
 * Number of substitutions an argument passes: an array literal's length; a string, a template
 * without expressions or a number literal is exactly 1; anything else is "some".
 */
function subsCount(arg) {
  if (arg === undefined) return 0;
  const first = arg[0];
  const lastTok = arg[arg.length - 1];
  if (first?.type === "punct" && first.value === "[" && lastTok?.value === "]") {
    const inner = arg.slice(1, -1);
    if (inner.length === 0) return 0;
    let depth = 0;
    let count = 1;
    for (const tok of inner) {
      if (tok.type === "punct" && OPEN.has(tok.value)) depth++;
      else if (tok.type === "punct" && CLOSE.has(tok.value)) depth--;
      else if (depth === 0 && tok.type === "punct" && tok.value === ",") count++;
    }
    // A trailing comma does not add an element.
    return inner[inner.length - 1]?.value === "," ? count - 1 : count;
  }
  if (arg.length === 1) {
    if (first.type === "str" || first.type === "num") return 1;
    if (first.type === "tpl" && !first.dynamic) return 1;
  }
  return "some";
}

/** Static references found in one source file. */
export function scanSource(src, file) {
  const lineOf = (pos) => src.slice(0, pos).split("\n").length;
  const calls = []; // { key, file, line, callee, subs }
  const dynamic = []; // { prefix, file, line }
  const literals = new Set();
  const msgRefs = []; // { key, file, line }
  for (const m of src.matchAll(/__MSG_([A-Za-z0-9_@]+?)__/g)) {
    msgRefs.push({ key: m[1], file, line: lineOf(m.index) });
  }
  if (!CODE_EXT.test(file)) return { calls, dynamic, literals, msgRefs };
  const toks = tokenize(src);
  for (const tok of toks) {
    if (tok.type === "str") literals.add(tok.value);
    else if (tok.type === "tpl" && !tok.dynamic) literals.add(tok.head);
  }
  for (let k = 0; k < toks.length; k++) {
    const tok = toks[k];
    if (tok.type !== "ident" || !Object.hasOwn(CALLEES, tok.value)) continue;
    const prev = toks[k - 1];
    if (prev?.type === "ident" && prev.value === "function") continue;
    let open = k + 1;
    // optional call: getMessage?.(key)
    if (toks[open]?.value === "?" && toks[open + 1]?.value === "." && toks[open + 2]?.value === "(")
      open += 2;
    if (toks[open]?.type !== "punct" || toks[open].value !== "(") continue;
    const spec = CALLEES[tok.value];
    const args = callArgs(toks, open);
    const subs = spec.subs === "plural" ? "plural" : subsCount(args[spec.subs]);
    for (const idx of spec.keys) {
      for (const a of args[idx] ?? []) {
        const line = lineOf(a.start);
        if (a.type === "str" || (a.type === "tpl" && !a.dynamic)) {
          calls.push({
            key: a.type === "str" ? a.value : a.head,
            file,
            line,
            callee: tok.value,
            subs,
          });
        } else if (a.type === "tpl") {
          dynamic.push({ prefix: a.head, file, line });
        }
      }
    }
  }
  return { calls, dynamic, literals, msgRefs };
}

// ------------------------------------------------------------------------------- messages

/** `$NAME$` names (lower-cased) and the highest `$n` a message uses, chrome.i18n semantics. */
export function messageUsage(entry) {
  const message = String(entry?.message ?? "").replace(/\$\$/g, "");
  const named = new Set();
  for (const m of message.matchAll(/\$([A-Za-z0-9_@]+)\$/g)) named.add(m[1].toLowerCase());
  const placeholders = {};
  for (const [name, ph] of Object.entries(entry?.placeholders ?? {})) {
    placeholders[name.toLowerCase()] = String(ph?.content ?? "");
  }
  let maxIndex = 0;
  const positional = (text) => {
    for (const m of text.replace(/\$\$/g, "").matchAll(/\$([1-9])/g)) {
      maxIndex = Math.max(maxIndex, Number(m[1]));
    }
  };
  // Positional $n outside placeholders (after removing the $NAME$ references).
  positional(message.replace(/\$([A-Za-z0-9_@]+)\$/g, ""));
  for (const name of named) if (placeholders[name] !== undefined) positional(placeholders[name]);
  const undeclared = [...named].filter((n) => placeholders[n] === undefined);
  const unusedPlaceholders = Object.keys(placeholders).filter((n) => !named.has(n));
  return { named: [...named], maxIndex, undeclared, unusedPlaceholders };
}

function readLocale(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "node_modules" || name.startsWith(".")) continue;
      walk(p, out);
    } else out.push(p);
  }
  return out;
}

function sourceFiles(root, sources) {
  const files = [];
  for (const s of sources) {
    const abs = join(root, s);
    if (!existsSync(abs)) continue;
    if (statSync(abs).isDirectory()) files.push(...walk(abs));
    else files.push(abs);
  }
  return files
    .map((f) => relative(root, f).split(sep).join("/"))
    .filter((f) => (CODE_EXT.test(f) || f.endsWith(".html")) && !isTestFile(f))
    .sort();
}

const looksLikeKey = (k) => /[A-Z_]/.test(k);

/** Runs every check. Pure apart from reading files under `root`. */
export function checkI18n(root, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const localesRoot = join(root, opts.localesDir);
  const defaultPath = join(localesRoot, opts.defaultLocale, "messages.json");
  const messages = readLocale(defaultPath);
  const keys = Object.keys(messages);
  const keySet = new Set(keys);

  const files = sourceFiles(root, opts.sources);
  const calls = [];
  const dynamic = [];
  const literals = new Set();
  const msgRefs = [];
  for (const f of files) {
    const r = scanSource(readFileSync(join(root, f), "utf8"), f);
    calls.push(...r.calls);
    dynamic.push(...r.dynamic);
    msgRefs.push(...r.msgRefs);
    for (const l of r.literals) literals.add(l);
  }

  const problems = { unused: [], missing: [], placeholders: [], families: [], locales: [] };
  const used = new Set();

  // Direct calls and __MSG_ references.
  for (const c of calls) {
    if (keySet.has(c.key)) used.add(c.key);
    else problems.missing.push({ key: c.key, at: `${c.file}:${c.line}`, via: `${c.callee}()` });
  }
  for (const r of msgRefs) {
    if (r.key.startsWith("@@")) continue; // predefined chrome.i18n messages
    if (keySet.has(r.key)) used.add(r.key);
    else problems.missing.push({ key: r.key, at: `${r.file}:${r.line}`, via: "__MSG__" });
  }
  // Key literals.
  for (const k of keys) if (looksLikeKey(k) && literals.has(k)) used.add(k);
  // Dynamic families.
  const families = opts.families.map((f) => ({
    ...f,
    keys: keys.filter((k) => k.startsWith(f.prefix)),
    builtAt: dynamic.filter((d) => d.prefix === f.prefix).map((d) => `${d.file}:${d.line}`),
  }));
  for (const f of families) {
    if (f.builtAt.length === 0) {
      problems.families.push(`family "${f.prefix}*" is declared but no source builds it`);
    } else if (f.keys.length === 0) {
      problems.families.push(`family "${f.prefix}*" is built but has no keys`);
    } else {
      for (const k of f.keys) used.add(k);
    }
  }
  for (const d of dynamic) {
    if (!opts.families.some((f) => f.prefix === d.prefix)) {
      problems.families.push(
        `${d.file}:${d.line} builds a key from \`${d.prefix}\${…}\`: declare the family in DYNAMIC_FAMILIES`,
      );
    }
  }
  problems.unused = keys.filter((k) => !used.has(k));

  // Placeholders: in each message, then at each direct call site.
  const usage = Object.fromEntries(keys.map((k) => [k, messageUsage(messages[k])]));
  for (const k of keys) {
    const u = usage[k];
    for (const n of u.undeclared) {
      problems.placeholders.push(
        `${k}: uses $${n.toUpperCase()}$ but declares no placeholder "${n}"`,
      );
    }
    for (const n of u.unusedPlaceholders) {
      problems.placeholders.push(
        `${k}: placeholder "${n}" is declared but the message never uses it`,
      );
    }
  }
  for (const c of calls) {
    const u = usage[c.key];
    if (!u) continue;
    const at = `${c.file}:${c.line}`;
    if (c.subs === "plural") {
      if (u.maxIndex > 1) {
        problems.placeholders.push(
          `${at} plural "${c.key}" uses $${u.maxIndex}; plural passes only $1`,
        );
      }
    } else if (c.subs === 0) {
      if (u.maxIndex > 0) {
        problems.placeholders.push(
          `${at} ${c.callee}("${c.key}") passes no substitutions; the message uses $${u.maxIndex}`,
        );
      }
    } else if (c.subs === "some") {
      if (u.maxIndex === 0) {
        problems.placeholders.push(
          `${at} ${c.callee}("${c.key}") passes substitutions; the message uses none`,
        );
      }
    } else if (u.maxIndex === 0) {
      problems.placeholders.push(
        `${at} ${c.callee}("${c.key}") passes substitutions; the message uses none`,
      );
    } else if (c.subs !== u.maxIndex) {
      problems.placeholders.push(
        `${at} ${c.callee}("${c.key}") passes ${c.subs} substitution(s); the message uses up to $${u.maxIndex}`,
      );
    }
  }

  // Other locales.
  const locales = existsSync(localesRoot)
    ? readdirSync(localesRoot).filter((d) => existsSync(join(localesRoot, d, "messages.json")))
    : [];
  for (const loc of locales) {
    if (loc === opts.defaultLocale) continue;
    const other = readLocale(join(localesRoot, loc, "messages.json"));
    for (const [k, entry] of Object.entries(other)) {
      if (!keySet.has(k)) {
        problems.locales.push(`${loc}: "${k}" is not in ${opts.defaultLocale}`);
        continue;
      }
      const a = usage[k];
      const b = messageUsage(entry);
      if (a.maxIndex !== b.maxIndex || [...a.named].sort().join() !== [...b.named].sort().join()) {
        problems.locales.push(`${loc}: "${k}" placeholders differ from ${opts.defaultLocale}`);
      }
      for (const n of b.undeclared)
        problems.locales.push(`${loc}: "${k}" uses $${n.toUpperCase()}$ undeclared`);
    }
  }

  const ok = Object.values(problems).every((p) => p.length === 0);
  return {
    ok,
    root,
    keys: keys.length,
    locales: locales.sort(),
    files: files.length,
    families: families.map(({ prefix, why, keys: k, builtAt }) => ({
      prefix,
      why,
      keys: k.length,
      builtAt,
    })),
    problems,
  };
}

export function formatReport(r) {
  const out = [
    `i18n: ${r.keys} keys (${r.locales.join(", ") || "no locales"}), ${r.files} source files`,
  ];
  for (const f of r.families) {
    out.push(`  dynamic family ${f.prefix}* (${f.keys} keys): ${f.why}`);
  }
  const section = (title, items, fmt = (x) => x) => {
    if (items.length === 0) return;
    out.push(`${title} (${items.length}):`);
    for (const it of items) out.push(`  ${fmt(it)}`);
  };
  section("unused keys (not referenced by any source)", r.problems.unused);
  section(
    "missing keys (referenced, not in the default locale)",
    r.problems.missing,
    (m) => `${m.at} ${m.via} "${m.key}"`,
  );
  section("placeholder mismatches", r.problems.placeholders);
  section("dynamic families", r.problems.families);
  section("other locales", r.problems.locales);
  out.push(r.ok ? "i18n ok" : "i18n FAILED");
  return out.join("\n");
}

function main(argv) {
  let root = process.cwd();
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") json = true;
    else if (a === "--root") root = argv[++i] ?? root;
    else if (a.startsWith("--root=")) root = a.slice("--root=".length);
    else {
      console.error(`unknown argument: ${a}`);
      return 2;
    }
  }
  const result = checkI18n(root);
  console.log(json ? JSON.stringify(result, null, 2) : formatReport(result));
  return result.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
