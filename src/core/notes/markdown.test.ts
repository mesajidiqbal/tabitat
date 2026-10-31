import { describe, expect, it } from "vitest";
import { type Inline, parseInline, parseMarkdown, safeHref } from "./markdown";

const text = (t: string): Inline => ({ type: "text", text: t });
const para = (...children: Inline[]) => ({ type: "paragraph", children });

describe("parseMarkdown blocks", () => {
  it("headings level 1 and 2; ### stays a paragraph", () => {
    expect(parseMarkdown("# Title\n## Sub\n### Deeper")).toEqual([
      { type: "heading", level: 1, children: [text("Title")] },
      { type: "heading", level: 2, children: [text("Sub")] },
      para(text("### Deeper")),
    ]);
  });

  it("a # without a space is text", () => {
    expect(parseMarkdown("#tag")).toEqual([para(text("#tag"))]);
  });

  it("paragraphs split on blank lines; lines inside one keep their newline", () => {
    expect(parseMarkdown("one\ntwo\n\nthree")).toEqual([
      para(text("one\ntwo")),
      para(text("three")),
    ]);
  });

  it("CRLF input is normalised", () => {
    expect(parseMarkdown("a\r\nb\r\n\r\nc")).toEqual([para(text("a\nb")), para(text("c"))]);
  });

  it("unordered lists with - and *", () => {
    expect(parseMarkdown("- a\n* b\n- c")).toEqual([
      { type: "list", ordered: false, start: 1, items: [[text("a")], [text("b")], [text("c")]] },
    ]);
  });

  it("ordered lists keep their start number; 1) works too", () => {
    expect(parseMarkdown("3. x\n4) y")).toEqual([
      { type: "list", ordered: true, start: 3, items: [[text("x")], [text("y")]] },
    ]);
  });

  it("switching list kind starts a new list; a blank line ends a list", () => {
    const out = parseMarkdown("- a\n1. b\n\n- c");
    expect(out.map((b) => b.type === "list" && b.ordered)).toEqual([false, true, false]);
  });

  it("a plain line after an item continues it", () => {
    expect(parseMarkdown("- first\n  more")).toEqual([
      { type: "list", ordered: false, start: 1, items: [[text("first\nmore")]] },
    ]);
  });

  it("a paragraph followed by a list and a heading", () => {
    const out = parseMarkdown("intro\n- item\n# H");
    expect(out.map((b) => b.type)).toEqual(["paragraph", "list", "heading"]);
  });

  it("empty input has no blocks", () => {
    expect(parseMarkdown("")).toEqual([]);
    expect(parseMarkdown("\n\n  \n")).toEqual([]);
  });
});

describe("parseInline", () => {
  it("bold, italic and code", () => {
    expect(parseInline("a **b** *c* `d`")).toEqual([
      text("a "),
      { type: "bold", children: [text("b")] },
      text(" "),
      { type: "italic", children: [text("c")] },
      text(" "),
      { type: "code", text: "d" },
    ]);
  });

  it("italic inside bold and bold inside italic", () => {
    expect(parseInline("**a *b* c**")).toEqual([
      {
        type: "bold",
        children: [text("a "), { type: "italic", children: [text("b")] }, text(" c")],
      },
    ]);
    expect(parseInline("*x **y** z*")).toEqual([
      {
        type: "italic",
        children: [text("x "), { type: "bold", children: [text("y")] }, text(" z")],
      },
    ]);
  });

  it("code content is raw (no markup inside)", () => {
    expect(parseInline("`**not bold**`")).toEqual([{ type: "code", text: "**not bold**" }]);
  });

  it("unclosed markers stay text", () => {
    expect(parseInline("**open")).toEqual([text("**open")]);
    expect(parseInline("*open")).toEqual([text("*open")]);
    expect(parseInline("`open")).toEqual([text("`open")]);
    expect(parseInline("2 * 3 * 4")).toEqual([text("2 * 3 * 4")]);
  });

  it("http(s) links with inline children", () => {
    expect(parseInline("see [the **docs**](https://example.com/a?b=1)")).toEqual([
      text("see "),
      {
        type: "link",
        href: "https://example.com/a?b=1",
        children: [text("the "), { type: "bold", children: [text("docs")] }],
      },
    ]);
    expect(parseInline("[x](http://h.test)")[0]).toMatchObject({ type: "link" });
  });

  it("non-http(s) links stay text (javascript:, data:, relative, chrome:)", () => {
    for (const url of ["javascript:alert(1)", "data:text/html,x", "/relative", "chrome://settings"])
      expect(parseInline(`[x](${url})`)).toEqual([text(`[x](${url})`)]);
  });

  it("images are not rendered: the ! stays text", () => {
    expect(parseInline("![alt](https://e.test/i.png)")).toEqual([
      text("!"),
      { type: "link", href: "https://e.test/i.png", children: [text("alt")] },
    ]);
  });

  it("no nested links", () => {
    const out = parseInline("[a [b](https://b.test)](https://a.test)");
    const links = out.filter((n) => n.type === "link");
    expect(links).toHaveLength(1);
    const kids = links[0]?.type === "link" ? links[0].children : [];
    expect(kids.some((n) => n.type === "link")).toBe(false);
  });

  it("backslash escapes make markers literal", () => {
    expect(parseInline("\\*not italic\\* \\`x\\`")).toEqual([text("*not italic* `x`")]);
    expect(parseInline("a\\b")).toEqual([text("a\\b")]);
  });
});

describe("escaping / no HTML passthrough", () => {
  it("<script> stays text", () => {
    expect(parseMarkdown("<script>alert(1)</script>")).toEqual([
      para(text("<script>alert(1)</script>")),
    ]);
  });

  it("HTML inside inline constructs stays text", () => {
    expect(parseInline("**<b>x</b>** `<img src=x onerror=y>`")).toEqual([
      { type: "bold", children: [text("<b>x</b>")] },
      text(" "),
      { type: "code", text: "<img src=x onerror=y>" },
    ]);
  });

  it("entities and quotes are not decoded or altered", () => {
    expect(parseMarkdown("&lt;b&gt; \"q\" 'a'")).toEqual([para(text("&lt;b&gt; \"q\" 'a'"))]);
  });

  it("deep nesting is bounded", () => {
    const deep = `${"*".repeat(40)}x${"*".repeat(40)}`;
    expect(() => parseInline(deep)).not.toThrow();
  });
});

describe("safeHref", () => {
  it("accepts absolute http(s) only", () => {
    expect(safeHref(" https://a.test/x ")).toBe("https://a.test/x");
    expect(safeHref("HTTP://A.test")).toBe("http://a.test/");
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("https://")).toBeNull();
    expect(safeHref("ftp://a.test")).toBeNull();
  });
});

describe("adversarial input stays linear", () => {
  const N = 40_000;
  const BOUND_MS = 100;

  /** Parses `src`, asserts the time bound, returns the first block's inline children. */
  function timed(name: string, src: string): Inline[] {
    const t0 = performance.now();
    const blocks = parseMarkdown(src);
    const ms = performance.now() - t0;
    console.info(`[markdown perf] ${name}: ${ms.toFixed(1)} ms`);
    expect(ms).toBeLessThan(BOUND_MS);
    const first = blocks[0];
    expect(first).toBeDefined();
    return first?.type === "list"
      ? (first.items[0] ?? [])
      : (first as { children: Inline[] }).children;
  }

  const flat = (nodes: Inline[]) =>
    nodes.map((n) => (n.type === "text" || n.type === "code" ? n.text : "")).join("");
  const onlyText = (nodes: Inline[], joined: string) => {
    expect(nodes.every((n) => n.type === "text")).toBe(true);
    expect(flat(nodes)).toBe(joined);
  };
  const hasText = (nodes: Inline[]) => expect(nodes.some((n) => n.type === "text")).toBe(true);

  it("unmatched [", () => {
    const src = "[".repeat(N);
    onlyText(timed("unmatched [", src), src);
    const src2 = "[a".repeat(N / 2);
    onlyText(timed("[a x20k", src2), src2);
  });

  it("[x]( without a closing paren", () => {
    const src = "[a](".repeat(N / 4);
    onlyText(timed("[a]( x10k", src), src);
    const src2 = `${"[a](http://x ".repeat(N / 13)})`;
    hasText(timed("[a](http://x x3k + )", src2));
    const src3 = `${"[a](http://x.io/(".repeat(N / 20)}))`;
    hasText(timed("[a](http://x.io/( x2k + ))", src3));
  });

  it("unmatched *", () => {
    const src = "*".repeat(N);
    onlyText(timed("unmatched *", src), src);
  });

  it("* that always follows a space has no closer", () => {
    const src = "*a ".repeat(N / 3);
    hasText(timed("*a x13k", src));
  });

  it("many ** pairs and strays", () => {
    hasText(timed("**a x10k", "**a ".repeat(N / 4)));
    hasText(timed("**a x with one backtick", `**a \`${"**a ".repeat(N / 4)}`));
  });

  it("backticks", () => {
    hasText(timed("backticks", "`".repeat(N)));
    hasText(timed("`` x20k", "``a".repeat(N / 3)));
    const src2 = `*a \`${"*a ".repeat(N / 3)}`;
    hasText(timed("*a with one backtick", src2));
  });

  it("long whitespace runs and many list lines", () => {
    const ws = `${" ".repeat(N)}x`;
    expect(timed("whitespace run", ws).length).toBeGreaterThan(0);
    const t0 = performance.now();
    const blocks = parseMarkdown(Array.from({ length: N }, (_, i) => `- item ${i}`).join("\n"));
    expect(performance.now() - t0).toBeLessThan(BOUND_MS * 4);
    expect(blocks).toHaveLength(1);
  });

  it("deeply nested lists", () => {
    const src = Array.from(
      { length: 5000 },
      (_, i) => `${" ".repeat(i % 4)}- `.repeat(1) + "- ".repeat(i % 50),
    ).join("\n");
    const t0 = performance.now();
    const blocks = parseMarkdown(src);
    const ms = performance.now() - t0;
    console.info(`[markdown perf] nested lists: ${ms.toFixed(1)} ms`);
    expect(ms).toBeLessThan(BOUND_MS);
    expect(blocks.length).toBeGreaterThan(0);
    const deep = timed("one deep list line", `- ${"- ".repeat(N / 2)}x`);
    expect(deep.every((n) => n.type === "text")).toBe(true);
  });

  it("closers are still found after a failed search elsewhere", () => {
    expect(parseInline("no close * **b** *c* [a](https://x.io)")).toEqual([
      text("no close * "),
      { type: "bold", children: [text("b")] },
      text(" "),
      { type: "italic", children: [text("c")] },
      text(" "),
      { type: "link", href: "https://x.io/", children: [text("a")] },
    ]);
  });
});

describe("links with parentheses in the URL", () => {
  it("balanced parentheses stay in the target; the link ends at the first unbalanced )", () => {
    expect(parseInline("[Foo](https://en.wikipedia.org/wiki/Foo_(bar)) after")).toEqual([
      { type: "link", href: "https://en.wikipedia.org/wiki/Foo_(bar)", children: [text("Foo")] },
      text(" after"),
    ]);
    expect(parseInline("(see [a](https://x.io/a_(b_(c))) now)")).toEqual([
      text("(see "),
      { type: "link", href: "https://x.io/a_(b_(c))", children: [text("a")] },
      text(" now)"),
    ]);
    expect(parseInline("[a](https://x.io/p)(q)")).toEqual([
      { type: "link", href: "https://x.io/p", children: [text("a")] },
      text("(q)"),
    ]);
  });

  it("an unbalanced target degrades to text", () => {
    expect(parseInline("[a](https://x.io/a_(b)")).toEqual([text("[a](https://x.io/a_(b)")]);
    expect(parseInline("[a](https://x.io/a_((b)")).toEqual([text("[a](https://x.io/a_((b)")]);
  });

  it("stays linear with many open parentheses", () => {
    const src = `${"[a](http://x.io/(".repeat(2500)}))`;
    const t0 = performance.now();
    const nodes = parseInline(src);
    const ms = performance.now() - t0;
    console.info(`[markdown perf] [a](http://x.io/( x2500: ${ms.toFixed(1)} ms`);
    expect(ms).toBeLessThan(100);
    expect(nodes.some((n) => n.type === "text")).toBe(true);
  });
});
