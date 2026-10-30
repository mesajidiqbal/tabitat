/**
 * Light markdown for notes (docs/PHASE4.md §4 Notes). Pure: returns a tree the UI renders with
 * Preact elements (never innerHTML), so every character of the input stays text.
 *
 * Blocks: `#` / `##` headings, paragraphs (lines joined with "\n"), unordered (`-` / `*`) and
 * ordered (`1.` / `1)`) lists. Inline: `**bold**`, `*italic*`, `` `code` ``,
 * `[text](http(s) url)`, `\` escapes. No HTML passthrough, no images: `![x](y)` stays text (the
 * `!` is literal, the link part still renders as a link when its URL is http(s)).
 */

export type Inline =
  | { type: "text"; text: string }
  | { type: "bold"; children: Inline[] }
  | { type: "italic"; children: Inline[] }
  | { type: "code"; text: string }
  | { type: "link"; href: string; children: Inline[] };

export type Block =
  | { type: "heading"; level: 1 | 2; children: Inline[] }
  | { type: "paragraph"; children: Inline[] }
  | { type: "list"; ordered: boolean; start: number; items: Inline[][] };

const HEADING = /^(#{1,2})\s+(.*)$/;
const BULLET = /^\s{0,3}[-*]\s+(.*)$/;
const NUMBERED = /^\s{0,3}(\d{1,9})[.)]\s+(.*)$/;
/** Characters a backslash makes literal. */
const ESCAPABLE = "\\`*_[]()#-.!>+";
const MAX_DEPTH = 8;

/** Only absolute http(s) URLs become links. */
export function safeHref(raw: string): string | null {
  const url = raw.trim();
  if (!/^https?:\/\//i.test(url)) return null;
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}

function pushText(out: Inline[], text: string): void {
  if (text === "") return;
  const last = out[out.length - 1];
  if (last?.type === "text") last.text += text;
  else out.push({ type: "text", text });
}

/** Index of the closing `*` of an italic run starting at `from` (not part of `**`), or -1. */
function closingStar(s: string, from: number): number {
  for (let i = from; i < s.length; i++) {
    const ch = s[i];
    if (ch === "\\") i++;
    else if (ch === "`") {
      const end = s.indexOf("`", i + 1);
      if (end > 0) i = end;
    } else if (ch === "*") {
      if (s[i + 1] === "*") i++;
      else if (s[i - 1] !== " ") return i;
    }
  }
  return -1;
}

/** Index of `marker` at or after `from`, skipping escapes and code spans; -1 when absent. */
function closing(s: string, from: number, marker: string): number {
  for (let i = from; i < s.length; i++) {
    const ch = s[i];
    if (ch === "\\") i++;
    else if (ch === "`" && marker !== "`") {
      const end = s.indexOf("`", i + 1);
      if (end > 0) i = end;
    } else if (s.startsWith(marker, i)) return i;
  }
  return -1;
}

/** Inline nodes of one block's text. */
export function parseInline(s: string, depth = 0, inLink = false): Inline[] {
  const out: Inline[] = [];
  if (depth > MAX_DEPTH) {
    pushText(out, s);
    return out;
  }
  let i = 0;
  while (i < s.length) {
    const ch = s[i] as string;
    if (ch === "\\" && i + 1 < s.length && ESCAPABLE.includes(s[i + 1] as string)) {
      pushText(out, s[i + 1] as string);
      i += 2;
      continue;
    }
    if (ch === "`") {
      const end = s.indexOf("`", i + 1);
      if (end > i + 1) {
        out.push({ type: "code", text: s.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if (ch === "*" && s[i + 1] === "*") {
      const end = closing(s, i + 2, "**");
      if (end > i + 2 && s[i + 2] !== " ") {
        out.push({ type: "bold", children: parseInline(s.slice(i + 2, end), depth + 1, inLink) });
        i = end + 2;
        continue;
      }
    }
    if (ch === "*" && s[i + 1] !== "*" && s[i + 1] !== " " && i + 1 < s.length) {
      const end = closingStar(s, i + 1);
      if (end > i + 1) {
        out.push({
          type: "italic",
          children: parseInline(s.slice(i + 1, end), depth + 1, inLink),
        });
        i = end + 1;
        continue;
      }
    }
    if (ch === "[" && !inLink) {
      const close = closing(s, i + 1, "]");
      if (close > i && s[close + 1] === "(") {
        const paren = s.indexOf(")", close + 2);
        const href = paren > 0 ? safeHref(s.slice(close + 2, paren)) : null;
        if (href !== null) {
          out.push({
            type: "link",
            href,
            children: parseInline(s.slice(i + 1, close), depth + 1, true),
          });
          i = paren + 1;
          continue;
        }
      }
    }
    pushText(out, ch);
    i++;
  }
  return out;
}

interface ListDraft {
  ordered: boolean;
  start: number;
  items: string[];
}

/** Block tree of a note. */
export function parseMarkdown(text: string): Block[] {
  const blocks: Block[] = [];
  const st: { para: string[]; list: ListDraft | null } = { para: [], list: null };
  const flushPara = () => {
    if (st.para.length > 0)
      blocks.push({ type: "paragraph", children: parseInline(st.para.join("\n")) });
    st.para = [];
  };
  const flushList = () => {
    const l = st.list;
    if (l) {
      const items = l.items.map((x) => parseInline(x));
      blocks.push({ type: "list", ordered: l.ordered, start: l.start, items });
    }
    st.list = null;
  };
  const addItem = (ordered: boolean, start: number, body: string) => {
    flushPara();
    if (st.list && st.list.ordered !== ordered) flushList();
    st.list ??= { ordered, start, items: [] };
    st.list.items.push(body);
  };

  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.replace(/\s+$/, "");
    if (line.trim() === "") {
      flushPara();
      flushList();
      continue;
    }
    const h = HEADING.exec(line);
    if (h) {
      flushPara();
      flushList();
      const level = (h[1] as string).length === 1 ? 1 : 2;
      blocks.push({ type: "heading", level, children: parseInline((h[2] as string).trim()) });
      continue;
    }
    const b = BULLET.exec(line);
    if (b) {
      addItem(false, 1, b[1] as string);
      continue;
    }
    const n = NUMBERED.exec(line);
    if (n) {
      addItem(true, Number(n[1]), n[2] as string);
      continue;
    }
    const l = st.list;
    if (l) {
      // Lazy continuation: a plain line right after an item belongs to that item.
      const last = l.items.length - 1;
      l.items[last] = `${l.items[last]}\n${line.trim()}`;
      continue;
    }
    st.para.push(line);
  }
  flushPara();
  flushList();
  return blocks;
}
