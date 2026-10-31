import { describe, expect, it } from "vitest";
import type { SavedLink, SessionGeneration } from "../model/types";
import { buildPlaceholderUrl } from "../ops/url";
import { BASE, NOW, savedTab, workspaceMeta, workspaceTabs } from "../testing/fixtures";
import {
  buildHtmlExport,
  DEFAULT_EXPORT_LABELS,
  escapeHtml,
  exportFilename,
  savedLinksOf,
  stripQueryAndHash,
  withSavedLinks,
} from "./html";

const S = (ms: number) => String(Math.floor(ms / 1000));
const link = (id: string, url: string, order: number, title = id): SavedLink => ({
  id,
  url,
  title,
  order,
  addedAt: NOW - 5000,
});

describe("buildHtmlExport (all)", () => {
  it("writes the exact Netscape layout: workspaces, saved links, quick links", () => {
    const meta = workspaceMeta("A", {
      name: "Work",
      resources: [link("l2", "https://b.example/", 1, "B"), link("l1", "https://a.example/", 0)],
    });
    const tabs = workspaceTabs([
      savedTab({ id: "t1", url: "https://one.example/", title: "One" }),
      savedTab({ id: "t2", url: "https://two.example/", title: "Two" }),
    ]);
    const { html, filename } = buildHtmlExport(
      {
        kind: "all",
        workspaces: withSavedLinks([{ meta, tabs }]),
        quicklinks: {
          items: [{ id: "q", url: "https://q.example/", title: "Q", order: 0 }],
          rev: 1,
        },
      },
      { now: NOW },
    );
    expect(filename).toBe("tabitat-2027-01-15.html");
    expect(html).toBe(
      [
        "<!DOCTYPE NETSCAPE-Bookmark-file-1>",
        '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
        "<TITLE>Tabitat export</TITLE>",
        "<H1>Tabitat export — 2027-01-15</H1>",
        "<DL><p>",
        `  <DT><H3 ADD_DATE="${S(meta.createdAt)}">Work</H3>`,
        "  <DL><p>",
        `    <DT><A HREF="https://one.example/" ADD_DATE="${S(tabs.updatedAt)}">One</A>`,
        `    <DT><A HREF="https://two.example/" ADD_DATE="${S(tabs.updatedAt)}">Two</A>`,
        "    <DT><H3>Saved links</H3>",
        "    <DL><p>",
        `      <DT><A HREF="https://a.example/" ADD_DATE="${S(NOW - 5000)}">l1</A>`,
        `      <DT><A HREF="https://b.example/" ADD_DATE="${S(NOW - 5000)}">B</A>`,
        "    </DL><p>",
        "  </DL><p>",
        "  <DT><H3>Quick links</H3>",
        "  <DL><p>",
        `    <DT><A HREF="https://q.example/" ADD_DATE="${S(NOW)}">Q</A>`,
        "  </DL><p>",
        "</DL><p>",
        "",
      ].join("\n"),
    );
    expect(html).not.toContain("\r");
  });

  it('escapes & < > " in names, titles and URLs', () => {
    const meta = workspaceMeta("A", { name: 'R&D <"x">' });
    const tabs = workspaceTabs([
      savedTab({ id: "t", url: 'https://e.example/?a=1&b="2"', title: "<script>&amp;" }),
    ]);
    const { html } = buildHtmlExport(
      {
        kind: "all",
        workspaces: withSavedLinks([{ meta, tabs }]),
        quicklinks: { items: [], rev: 0 },
      },
      { now: NOW },
    );
    expect(html).toContain("<H3 ADD_DATE");
    expect(html).toContain(">R&amp;D &lt;&quot;x&quot;&gt;</H3>");
    // the URL parser already percent-encodes quotes in a query; escaping still applies to &
    expect(html).toContain('HREF="https://e.example/?a=1&amp;b=&quot;2&quot;"');
    expect(html).toContain(">&lt;script&gt;&amp;amp;</A>");
    expect(html).not.toContain("<script>");
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;'");
  });

  it("strips queries and fragments when asked", () => {
    const meta = workspaceMeta("A", {
      resources: [link("l", "https://l.example/p?token=secret#frag", 0)],
    });
    const tabs = workspaceTabs([savedTab({ id: "t", url: "https://t.example/x?q=1#h" })]);
    const input = {
      kind: "all" as const,
      workspaces: withSavedLinks([{ meta, tabs }]),
      quicklinks: {
        items: [{ id: "q", url: "https://q.example/?s=1", title: "Q", order: 0 }],
        rev: 1,
      },
    };
    const plain = buildHtmlExport(input, { now: NOW }).html;
    expect(plain).toContain("token=secret");
    const stripped = buildHtmlExport(input, { now: NOW, stripQuery: true }).html;
    expect(stripped).not.toMatch(/[?#]/);
    expect(stripped).toContain('HREF="https://t.example/x"');
    expect(stripped).toContain('HREF="https://l.example/p"');
    expect(stripped).toContain('HREF="https://q.example/"');
    expect(stripQueryAndHash("not a url?x=1#y")).toBe("not a url");
  });

  it("skips non-restorable URLs (javascript:, data:, foreign internal schemes)", () => {
    const meta = workspaceMeta("A", {
      resources: [link("bad", "javascript:alert(1)", 0), link("bad2", "data:text/html,x", 1)],
    });
    const tabs = workspaceTabs([
      savedTab({ id: "a", url: "javascript:alert(1)" }),
      savedTab({ id: "b", url: "data:text/html,<b>x</b>" }),
      savedTab({ id: "c", url: "edge://settings" }),
      savedTab({ id: "d", url: "chrome://history/", title: "History" }),
      savedTab({ id: "e", url: "https://ok.example/" }),
    ]);
    const { html } = buildHtmlExport(
      {
        kind: "all",
        workspaces: withSavedLinks([{ meta, tabs }]),
        quicklinks: { items: [{ id: "q", url: "vbscript:x", title: "Q", order: 0 }], rev: 1 },
      },
      { now: NOW },
    );
    expect(html).not.toMatch(/javascript:|data:|edge:|vbscript:/);
    expect(html).toContain('HREF="chrome://history/"');
    expect(html).toContain('HREF="https://ok.example/"');
    // every link was skipped: no empty "Saved links" / "Quick links" folder
    expect(html).not.toContain("Saved links");
    expect(html).not.toContain("Quick links");
  });

  it("unwraps placeholder URLs when a base is given; empty titles fall back to the URL", () => {
    const ph = buildPlaceholderUrl(BASE, { u: "https://real.example/a", t: "", w: "", s: "x" });
    const meta = workspaceMeta("A");
    const tabs = workspaceTabs([savedTab({ id: "t", url: ph, title: "  " })]);
    const input = {
      kind: "all" as const,
      workspaces: withSavedLinks([{ meta, tabs }]),
      quicklinks: { items: [], rev: 0 },
    };
    const { html } = buildHtmlExport(input, { now: NOW, placeholderBase: BASE });
    expect(html).toContain('<A HREF="https://real.example/a" ADD_DATE=');
    expect(html).toContain(">https://real.example/a</A>");
    // without a base an extension URL is not restorable: skipped
    expect(buildHtmlExport(input, { now: NOW }).html).not.toContain("suspended.html");
  });

  it("empty inputs: just the envelope; an empty workspace keeps its folder", () => {
    const { html } = buildHtmlExport(
      { kind: "all", workspaces: [], quicklinks: { items: [], rev: 0 } },
      { now: NOW },
    );
    expect(html.split("\n").slice(4)).toEqual(["<DL><p>", "</DL><p>", ""]);
    const one = buildHtmlExport(
      {
        kind: "all",
        workspaces: withSavedLinks([
          { meta: workspaceMeta("E", { name: "Empty" }), tabs: workspaceTabs([]) },
        ]),
        quicklinks: { items: [], rev: 0 },
      },
      { now: NOW },
    ).html;
    expect(one).toContain(">Empty</H3>\n  <DL><p>\n  </DL><p>\n</DL><p>\n");
  });

  it("orders tabs by index and saved links by order", () => {
    const meta = workspaceMeta("A", {
      resources: [link("z", "https://z.example/", 2), link("y", "https://y.example/", 0)],
    });
    expect(savedLinksOf(meta).map((l) => l.id)).toEqual(["y", "z"]);
    const tabs = {
      tabs: [
        savedTab({ id: "2", url: "https://2.example/", index: 1 }),
        savedTab({ id: "1", url: "https://1.example/", index: 0 }),
      ],
      updatedAt: NOW,
      rev: 1,
    };
    const { html } = buildHtmlExport(
      {
        kind: "all",
        workspaces: withSavedLinks([{ meta, tabs }]),
        quicklinks: { items: [], rev: 0 },
      },
      { now: NOW },
    );
    expect(html.indexOf("1.example")).toBeLessThan(html.indexOf("2.example"));
    expect(html.indexOf("y.example")).toBeLessThan(html.indexOf("z.example"));
  });
});

describe("buildHtmlExport (generation)", () => {
  const gen: SessionGeneration = {
    id: 7,
    takenAt: NOW - 60_000,
    windows: [
      {
        windowId: 11,
        workspaceId: "A",
        tabs: [savedTab({ id: "a", url: "https://a.example/?x=1", title: "A" })],
      },
      {
        windowId: 12,
        workspaceId: null,
        tabs: [
          savedTab({ id: "b", url: "https://b.example/", title: "B" }),
          savedTab({ id: "j", url: "javascript:void 0", index: 1 }),
        ],
      },
      { windowId: 13, workspaceId: "gone", tabs: [] },
    ],
  };

  it("one folder per window, named after the workspace when known", () => {
    const { html, filename } = buildHtmlExport(
      { kind: "generation", generation: gen, workspaceNames: { A: "Alpha" } },
      { now: NOW },
    );
    expect(filename).toBe("tabitat-session-7-2027-01-15.html");
    const t = S(gen.takenAt);
    expect(html.split("\n").slice(3)).toEqual([
      "<H1>Tabitat session 7 — 2027-01-15</H1>",
      "<DL><p>",
      `  <DT><H3 ADD_DATE="${t}">Alpha</H3>`,
      "  <DL><p>",
      `    <DT><A HREF="https://a.example/?x=1" ADD_DATE="${t}">A</A>`,
      "  </DL><p>",
      `  <DT><H3 ADD_DATE="${t}">Window 2</H3>`,
      "  <DL><p>",
      `    <DT><A HREF="https://b.example/" ADD_DATE="${t}">B</A>`,
      "  </DL><p>",
      `  <DT><H3 ADD_DATE="${t}">Window 3</H3>`,
      "  <DL><p>",
      "  </DL><p>",
      "</DL><p>",
      "",
    ]);
  });

  it("strips queries; ignores inherited names", () => {
    const { html } = buildHtmlExport(
      {
        kind: "generation",
        generation: {
          ...gen,
          windows: [{ windowId: 1, workspaceId: "constructor", tabs: gen.windows[0]?.tabs ?? [] }],
        },
        workspaceNames: {},
      },
      { now: NOW, stripQuery: true },
    );
    expect(html).toContain(">Window 1</H3>");
    expect(html).toContain('HREF="https://a.example/"');
  });
});

describe("exportFilename", () => {
  it("uses the UTC date of now", () => {
    expect(exportFilename(Date.UTC(2026, 9, 31, 23, 59))).toBe("tabitat-2026-10-31.html");
    expect(exportFilename(Date.UTC(2026, 0, 2), 3)).toBe("tabitat-session-3-2026-01-02.html");
  });
});

describe("export labels", () => {
  const all = {
    kind: "all" as const,
    workspaces: withSavedLinks([
      {
        meta: workspaceMeta("A", { name: "Work", resources: [link("l", "https://l.example/", 0)] }),
        tabs: workspaceTabs([savedTab({ id: "t", url: "https://t.example/" })]),
      },
    ]),
    quicklinks: {
      items: [{ id: "q", url: "https://q.example/", title: "Q", order: 0 }],
      rev: 1,
    },
  };
  const sessionInput = {
    kind: "generation" as const,
    generation: {
      id: 3,
      takenAt: NOW,
      windows: [
        {
          windowId: 1,
          workspaceId: null,
          tabs: [savedTab({ id: "w", url: "https://w.example/" })],
        },
      ],
    },
  };

  it("labels override the English strings (and are escaped)", () => {
    const labels = {
      title: "Export <T>",
      exportHeading: "Exportación",
      sessionHeading: "Sesión",
      savedLinks: "Enlaces guardados",
      quickLinks: "Enlaces rápidos",
      window: "Ventana",
    };
    const a = buildHtmlExport(all, { now: NOW, labels }).html;
    expect(a).toContain("<TITLE>Export &lt;T&gt;</TITLE>");
    expect(a).toContain("<H1>Exportación — 2027-01-15</H1>");
    expect(a).toContain("<DT><H3>Enlaces guardados</H3>");
    expect(a).toContain("<DT><H3>Enlaces rápidos</H3>");
    expect(a).not.toContain("Saved links");
    expect(a).not.toContain("Quick links");
    const s = buildHtmlExport(sessionInput, { now: NOW, labels }).html;
    expect(s).toContain("<H1>Sesión 3 — 2027-01-15</H1>");
    expect(s).toContain(">Ventana 1</H3>");
  });

  it("defaults apply when labels are missing, partial or empty", () => {
    const base = buildHtmlExport(all, { now: NOW }).html;
    expect(base).toContain("<TITLE>Tabitat export</TITLE>");
    expect(base).toContain("<H1>Tabitat export — 2027-01-15</H1>");
    expect(base).toContain("<DT><H3>Saved links</H3>");
    expect(base).toContain("<DT><H3>Quick links</H3>");
    expect(buildHtmlExport(sessionInput, { now: NOW }).html).toContain("<H1>Tabitat session 3 — ");
    const partial = buildHtmlExport(all, {
      now: NOW,
      labels: { quickLinks: "Mine", savedLinks: "", title: "  " },
    }).html;
    expect(partial).toContain("<DT><H3>Mine</H3>");
    expect(partial).toContain("<DT><H3>Saved links</H3>");
    expect(partial).toContain("<TITLE>Tabitat export</TITLE>");
    expect(buildHtmlExport(all, { now: NOW, labels: DEFAULT_EXPORT_LABELS }).html).toBe(base);
  });
});

describe("stripQuery and URL-shaped titles", () => {
  it("strips the query/hash from titles that are URLs, keeps other titles", () => {
    const tabs = workspaceTabs([
      savedTab({
        id: "a",
        url: "https://a.example/p?token=SECRET#frag",
        title: "https://a.example/p?token=SECRET#frag",
      }),
      savedTab({
        id: "b",
        url: "https://b.example/?x=1",
        title: "http://other.example/?y=2",
        index: 1,
      }),
      savedTab({ id: "c", url: "https://c.example/?x=1", title: "Docs ? what #1", index: 2 }),
    ]);
    const input = {
      kind: "all" as const,
      workspaces: withSavedLinks([{ meta: workspaceMeta("A", { name: "W" }), tabs }]),
      quicklinks: { items: [], rev: 0 },
    };
    const on = buildHtmlExport(input, { now: NOW, stripQuery: true }).html;
    expect(on).not.toContain("SECRET");
    expect(on).toContain(">https://a.example/p</A>");
    expect(on).toContain(">http://other.example/</A>");
    expect(on).toContain(">Docs ? what #1</A>");
    const off = buildHtmlExport(input, { now: NOW }).html;
    expect(off).toContain(">https://a.example/p?token=SECRET#frag</A>");
  });
});
