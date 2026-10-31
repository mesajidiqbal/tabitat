/**
 * Light markdown for notes (docs/PHASE4.md §4 Notes). Pure: returns a tree the UI renders with
 * Preact elements (never innerHTML), so every character of the input stays text.
 *
 * Blocks: `#` / `##` headings, paragraphs (lines joined with "\n"), unordered (`-` / `*`) and
 * ordered (`1.` / `1)`) lists. Inline: `**bold**`, `*italic*`, `` `code` ``,
 * `[text](http(s) url)` (balanced parentheses allowed in the URL), `\` escapes. No HTML passthrough, no images: `![x](y)` stays text (the
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

/**
 * Delimiter searches are memoised per string so a failed search is never repeated: a scan is
 * deterministic from any loop-top position, so every position one scan visits shares its result
 * and a later scan that reaches a visited position stops there. Each position is thus walked at
 * most once per delimiter, which keeps `[` / `*` / `**` runs without closers linear.
 */
const UNKNOWN = -2;

class Scan {
  private memo: Int32Array | null = null;
  constructor(
    private readonly s: string,
    private readonly step: (s: string, i: number) => { next: number; hit: boolean },
  ) {}

  /** Index of the first closer at or after `from`, or -1. */
  find(from: number): number {
    const { s } = this;
    this.memo ??= new Int32Array(s.length + 1).fill(UNKNOWN);
    const memo = this.memo;
    const path: number[] = [];
    let result = -1;
    let i = from;
    while (i < s.length) {
      const known = memo[i] as number;
      if (known !== UNKNOWN) {
        result = known;
        break;
      }
      path.push(i);
      const r = this.step(s, i);
      if (r.hit) {
        result = i;
        break;
      }
      i = r.next;
    }
    for (const p of path) memo[p] = result;
    return result;
  }
}

/** One step of the closing-`*` scan (an italic run: a `*` not part of `**`, not after a space). */
function starStep(s: string, at: number): { next: number; hit: boolean } {
  let i = at;
  const ch = s[i];
  if (ch === "\\") i++;
  else if (ch === "`") {
    const end = s.indexOf("`", i + 1);
    if (end > 0) i = end;
  } else if (ch === "*") {
    if (s[i + 1] === "*") i++;
    else if (s[i - 1] !== " ") return { next: i, hit: true };
  }
  return { next: i + 1, hit: false };
}

/** One step of a `marker` scan that skips escapes and code spans. */
function markerStep(marker: string) {
  return (s: string, at: number): { next: number; hit: boolean } => {
    let i = at;
    const ch = s[i];
    if (ch === "\\") i++;
    else if (ch === "`") {
      const end = s.indexOf("`", i + 1);
      if (end > 0) i = end;
    } else if (s.startsWith(marker, i)) return { next: i, hit: true };
    return { next: i + 1, hit: false };
  };
}

/**
 * For each index k of the prefix-balance array P (P[0] = 0, P[i+1] = P[i] + 1 for `(`, - 1 for
 * `)`), the first m > k with P[m] < P[k] (so `s[m-1]` is the `)` closing a target that starts at
 * k), or -1.
 */
function parenEnds(s: string): Int32Array {
  const n = s.length;
  const bal = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) {
    const c = s.charCodeAt(i);
    bal[i + 1] = (bal[i] as number) + (c === 40 ? 1 : c === 41 ? -1 : 0);
  }
  const next = new Int32Array(n + 1).fill(-1);
  const stack: number[] = [];
  for (let m = 0; m <= n; m++) {
    while (
      stack.length > 0 &&
      (bal[m] as number) < (bal[stack[stack.length - 1] as number] as number)
    ) {
      next[stack.pop() as number] = m;
    }
    stack.push(m);
  }
  return next;
}

/** Per-string search state for `parseInline`. */
class Searches {
  private star: Scan | null = null;
  private bold: Scan | null = null;
  private bracket: Scan | null = null;
  private parenEnd: Int32Array | null = null;
  constructor(private readonly s: string) {}

  closingStar(from: number): number {
    this.star ??= new Scan(this.s, starStep);
    return this.star.find(from);
  }
  closingBold(from: number): number {
    this.bold ??= new Scan(this.s, markerStep("**"));
    return this.bold.find(from);
  }
  closingBracket(from: number): number {
    this.bracket ??= new Scan(this.s, markerStep("]"));
    return this.bracket.find(from);
  }
  /**
   * Index of the `)` that ends a link target starting at `from`: the first one that is not
   * balanced by a `(` after `from`; -1 when the target never closes. The prefix balance
   * (`(` +1, `)` -1) is computed once and "next position with a lower balance" is answered for
   * every start by one monotonic-stack pass, so any number of links stays linear.
   */
  closingParen(from: number): number {
    this.parenEnd ??= parenEnds(this.s);
    const m = this.parenEnd[from] as number;
    return m < 0 ? -1 : m - 1;
  }
}

/** Inline nodes of one block's text. */
export function parseInline(s: string, depth = 0, inLink = false): Inline[] {
  const out: Inline[] = [];
  if (depth > MAX_DEPTH) {
    pushText(out, s);
    return out;
  }
  const find = new Searches(s);
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
      const end = find.closingBold(i + 2);
      if (end > i + 2 && s[i + 2] !== " ") {
        out.push({ type: "bold", children: parseInline(s.slice(i + 2, end), depth + 1, inLink) });
        i = end + 2;
        continue;
      }
    }
    if (ch === "*" && s[i + 1] !== "*" && s[i + 1] !== " " && i + 1 < s.length) {
      const end = find.closingStar(i + 1);
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
      const close = find.closingBracket(i + 1);
      if (close > i && s[close + 1] === "(") {
        const paren = find.closingParen(close + 2);
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
    const line = raw.trimEnd();
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
