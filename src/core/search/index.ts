/**
 * In-memory fuzzy index over tabs, saved tabs, links and history (fuzzysort). Pure.
 */
import fuzzysort, { type Prepared, type Result } from "fuzzysort";
import type { WorkspaceId } from "../model/types";

export type SearchDocKind = "tab" | "workspaceTab" | "link" | "quicklink" | "closed";

export interface SearchDoc {
  id: string;
  kind: SearchDocKind;
  title: string;
  url: string;
  workspaceId?: WorkspaceId;
  tabId?: number;
  windowId?: number;
}

export interface SearchHit {
  doc: SearchDoc;
  /** fuzzysort score: 1 exact … 0 no match. Empty queries return 0. */
  score: number;
  /**
   * HTML-escaped text with matches wrapped in `<mark>…</mark>`; only for fields that matched.
   * Safe to inject as HTML.
   */
  highlights?: { title?: string; url?: string };
}

export interface SearchIndexOptions {
  /** Minimum fuzzysort score (0..1). Default 0.3. */
  threshold?: number;
}

interface Entry {
  doc: SearchDoc;
  title: Prepared;
  url: Prepared;
}

const ESC: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESC[c] ?? c);
}

function highlight(r: Result | undefined): string | undefined {
  if (!r || r.score <= 0 || !r.target) return undefined;
  return r
    .highlight((m) => ({ m }))
    .map((part) =>
      typeof part === "string" ? escapeHtml(part) : `<mark>${escapeHtml(part.m)}</mark>`,
    )
    .join("");
}

const KEYS = [(e: Entry) => e.title, (e: Entry) => e.url];

export class SearchIndex {
  private readonly entries = new Map<string, Entry>();
  private list: Entry[] | null = null;
  private readonly threshold: number;

  constructor(opts: SearchIndexOptions = {}) {
    this.threshold = opts.threshold ?? 0.3;
  }

  get size(): number {
    return this.entries.size;
  }

  /** Replaces every doc; prepared targets are reused for docs whose title/url did not change. */
  replaceAll(docs: readonly SearchDoc[]): void {
    const old = new Map(this.entries);
    this.entries.clear();
    for (const doc of docs) this.put(doc, old.get(doc.id));
    this.list = null;
  }

  /** Inserts or updates a doc. An updated doc keeps its insertion position. */
  upsert(doc: SearchDoc): void {
    this.put(doc, this.entries.get(doc.id));
    this.list = null;
  }

  remove(id: string): boolean {
    const removed = this.entries.delete(id);
    if (removed) this.list = null;
    return removed;
  }

  /** Fuzzy match over title+url. An empty/blank query returns the first `limit` docs in insertion order. */
  query(q: string, limit = 20): SearchHit[] {
    const list = this.entriesList();
    const needle = q.trim();
    if (needle === "")
      return list.slice(0, Math.max(0, limit)).map((e) => ({ doc: e.doc, score: 0 }));
    if (limit <= 0) return [];
    const results = fuzzysort.go(needle, list, { keys: KEYS, limit, threshold: this.threshold });
    return results.map((r) => {
      const hit: SearchHit = { doc: r.obj.doc, score: r.score };
      const title = highlight(r[0]);
      const url = highlight(r[1]);
      if (title !== undefined || url !== undefined) {
        hit.highlights = {};
        if (title !== undefined) hit.highlights.title = title;
        if (url !== undefined) hit.highlights.url = url;
      }
      return hit;
    });
  }

  private put(doc: SearchDoc, prev: Entry | undefined): void {
    const title = prev && prev.doc.title === doc.title ? prev.title : fuzzysort.prepare(doc.title);
    const url = prev && prev.doc.url === doc.url ? prev.url : fuzzysort.prepare(doc.url);
    this.entries.set(doc.id, { doc, title, url });
  }

  private entriesList(): Entry[] {
    this.list ??= [...this.entries.values()];
    return this.list;
  }
}
