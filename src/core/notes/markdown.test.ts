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
