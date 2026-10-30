import fuzzysort from "fuzzysort";
import { afterEach, describe, expect, it, vi } from "vitest";
import { escapeHtml, type SearchDoc, SearchIndex } from "./index";

const doc = (id: string, title: string, url: string, over: Partial<SearchDoc> = {}): SearchDoc => ({
  id,
  kind: "tab",
  title,
  url,
  ...over,
});

const docs = [
  doc("1", "GitHub - tabitat", "https://github.com/me/tabitat", { tabId: 1, windowId: 1 }),
  doc("2", "Gmail - Inbox", "https://mail.google.com/mail/u/0", { kind: "workspaceTab" }),
  doc("3", "Hacker News", "https://news.ycombinator.com", { kind: "closed" }),
  doc("4", "<script>alert(1)</script>", "https://evil.example", { kind: "link", workspaceId: "w" }),
];

afterEach(() => vi.restoreAllMocks());

describe("SearchIndex", () => {
  it("empty query returns the first N docs in insertion order", () => {
    const idx = new SearchIndex();
    idx.replaceAll(docs);
    expect(idx.query("").map((h) => h.doc.id)).toEqual(["1", "2", "3", "4"]);
    expect(idx.query("   ", 2).map((h) => h.doc.id)).toEqual(["1", "2"]);
    expect(idx.query("", 2)[0]).toEqual({ doc: docs[0], score: 0 });
    expect(idx.query("", -1)).toEqual([]);
    expect(idx.size).toBe(4);
  });

  it("matches title or url fuzzily, best first", () => {
    const idx = new SearchIndex();
    idx.replaceAll(docs);
    expect(idx.query("github")[0]?.doc.id).toBe("1");
    expect(idx.query("ycombinator")[0]?.doc.id).toBe("3");
    expect(idx.query("gml")[0]?.doc.id).toBe("2");
    expect(idx.query("qqqqzzzz")).toEqual([]);
    expect(idx.query("github", 0)).toEqual([]);
  });

  it("returns escaped highlights only for matched fields", () => {
    const idx = new SearchIndex();
    idx.replaceAll(docs);
    const hit = idx.query("hacker")[0];
    expect(hit?.highlights?.title).toBe("<mark>Hacker</mark> News");
    expect(hit?.highlights).not.toHaveProperty("url");
    const urlOnly = idx.query("ycombinator")[0];
    expect(urlOnly?.highlights).not.toHaveProperty("title");
    expect(urlOnly?.highlights?.url).toContain("<mark>ycombinator</mark>");
    const evil = idx.query("alert")[0];
    expect(evil?.highlights?.title).toBe("&lt;script&gt;<mark>alert</mark>(1)&lt;/script&gt;");
  });

  it("respects limit", () => {
    const idx = new SearchIndex({ threshold: 0 });
    idx.replaceAll(
      Array.from({ length: 30 }, (_, i) => doc(`${i}`, `page ${i}`, `https://p${i}.com`)),
    );
    expect(idx.query("page", 5)).toHaveLength(5);
    expect(idx.query("page")).toHaveLength(20);
  });

  it("upsert updates in place (keeps position) and remove deletes", () => {
    const idx = new SearchIndex();
    idx.replaceAll(docs);
    idx.upsert(doc("2", "Calendar", "https://calendar.google.com"));
    idx.upsert(doc("5", "New one", "https://new.com"));
    expect(idx.query("").map((h) => h.doc.id)).toEqual(["1", "2", "3", "4", "5"]);
    expect(idx.query("calendar")[0]?.doc.title).toBe("Calendar");
    expect(idx.query("gmail")).toEqual([]);
    expect(idx.remove("2")).toBe(true);
    expect(idx.remove("2")).toBe(false);
    expect(idx.query("calendar")).toEqual([]);
    expect(idx.query("").map((h) => h.doc.id)).toEqual(["1", "3", "4", "5"]);
  });

  it("prepares each target once and reuses it while unchanged", () => {
    const spy = vi.spyOn(fuzzysort, "prepare");
    const idx = new SearchIndex();
    idx.replaceAll(docs);
    expect(spy).toHaveBeenCalledTimes(docs.length * 2);
    idx.query("git");
    idx.query("mail");
    expect(spy).toHaveBeenCalledTimes(docs.length * 2);
    idx.replaceAll(docs.map((d) => ({ ...d })));
    expect(spy).toHaveBeenCalledTimes(docs.length * 2);
    idx.upsert({ ...(docs[0] as SearchDoc), title: "changed" });
    expect(spy).toHaveBeenCalledTimes(docs.length * 2 + 1);
    idx.upsert({ ...(docs[0] as SearchDoc), title: "changed", kind: "closed" });
    expect(spy).toHaveBeenCalledTimes(docs.length * 2 + 1);
    expect(idx.query("changed")[0]?.doc.kind).toBe("closed");
  });
});

describe("escapeHtml", () => {
  it("escapes the five HTML specials", () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe(
      "&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;",
    );
  });
});
