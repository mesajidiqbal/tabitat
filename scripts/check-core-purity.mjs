// Fails if anything under src/core touches the browser APIs (core must stay pure).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = "src/core";
const forbidden = [
  { re: /from\s+["']wxt\/browser["']/, why: 'imports from "wxt/browser"' },
  { re: /\bchrome\./, why: "references chrome." },
  { re: /\bbrowser\./, why: "references browser." },
];

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

const violations = [];
for (const file of walk(root).filter((f) => /\.(ts|tsx|js|mjs)$/.test(f))) {
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    for (const { re, why } of forbidden) {
      if (re.test(line)) violations.push(`${file}:${i + 1} ${why}`);
    }
  });
}

if (violations.length > 0) {
  console.error(`core purity violations:\n${violations.join("\n")}`);
  process.exit(1);
}
console.log("core purity ok");
