/**
 * Universal search over the read model: live tabs (tab), every workspace's saved tabs
 * (workspaceTab; not the current window's own workspace, whose tabs are live), saved links
 * (link) and recently closed (closed), plus workspace names. The core SearchIndex is built on
 * first use and kept up to date incrementally by effects (never rebuilt per keystroke).
 */
import { effect, signal, untracked } from "@preact/signals";
import fuzzysort from "fuzzysort";
import { escapeHtml, type SearchDoc, type SearchDocKind, SearchIndex } from "@/core/search";
import { activateByUrl, activateTab, openUrl, switchTo } from "./actions";
import { activeWorkspaceId, owners, store, workspaces } from "./store";

export interface UiHit {
  key: string;
  kind: SearchDocKind | "workspace";
  title: string;
  url: string;
  /** Escaped HTML with <mark> highlights (safe to inject). */
  titleHtml: string;
  workspaceId?: string;
  tabId?: number;
  windowId?: number;
}

const index = new SearchIndex({ threshold: 0.3 });
/** Bumped on every index mutation so result computations re-run. */
export const searchVersion = signal(0);
let started = false;

const same = (a: SearchDoc, b: SearchDoc) =>
  a.title === b.title &&
  a.url === b.url &&
  a.workspaceId === b.workspaceId &&
  a.tabId === b.tabId &&
  a.windowId === b.windowId;

/** Keeps one source's docs in the index: removes vanished ids, upserts new/changed docs. */
function syncSource(prev: Map<string, SearchDoc>, docs: SearchDoc[]): Map<string, SearchDoc> {
  const next = new Map(docs.map((d) => [d.id, d]));
  let changed = false;
  for (const id of prev.keys()) if (!next.has(id)) changed = index.remove(id) || changed;
  for (const d of docs) {
    const old = prev.get(d.id);
    if (!old || !same(old, d)) {
      index.upsert(d);
      changed = true;
    }
  }
  if (changed) searchVersion.value++;
  return next;
}

function start(): void {
  started = true;
  let tabs = new Map<string, SearchDoc>();
  let saved = new Map<string, SearchDoc>();
  let links = new Map<string, SearchDoc>();
  let closed = new Map<string, SearchDoc>();
  effect(() => {
    tabs = syncSource(
      tabs,
      store.liveTabs.value.map((t) => ({
        id: `tab:${t.id}`,
        kind: "tab",
        title: t.title,
        url: t.url,
        tabId: t.id,
        windowId: t.windowId,
      })),
    );
  });
  effect(() => {
    const current = activeWorkspaceId.value;
    const docs: SearchDoc[] = [];
    for (const [ws, wt] of Object.entries(store.wsTabs.value)) {
      if (ws === current) continue;
      for (const t of wt.tabs)
        docs.push({
          id: `wt:${ws}:${t.id}`,
          kind: "workspaceTab",
          title: t.title,
          url: t.url,
          workspaceId: ws,
        });
    }
    saved = syncSource(saved, docs);
  });
  effect(() => {
    const docs: SearchDoc[] = [];
    for (const m of Object.values(store.metas.value)) {
      for (const l of m.resources)
        docs.push({
          id: `link:${m.id}:${l.id}`,
          kind: "link",
          title: l.title || l.url,
          url: l.url,
          workspaceId: m.id,
        });
    }
    links = syncSource(links, docs);
  });
  effect(() => {
    closed = syncSource(
      closed,
      store.recentlyClosed.value.map((c) => ({
        id: `closed:${c.id}`,
        kind: "closed",
        title: c.title || c.url,
        url: c.url,
      })),
    );
  });
}

/** Hits for `q`: matching workspaces first, then tabs / saved tabs / links / closed. */
export function search(q: string, limit = 50): UiHit[] {
  const needle = q.trim();
  if (needle === "") return [];
  // Effects created on first use must not be owned by the caller's render/computed.
  if (!started) untracked(start);
  void searchVersion.value; // dependency for render / computed() callers
  const out: UiHit[] = [];
  for (const m of workspaces.value) {
    const r = fuzzysort.single(needle, m.name);
    if (r && r.score >= 0.3) {
      const html = r
        .highlight((s) => ({ s }))
        .map((p) => (typeof p === "string" ? escapeHtml(p) : `<mark>${escapeHtml(p.s)}</mark>`))
        .join("");
      out.push({
        key: `ws:${m.id}`,
        kind: "workspace",
        title: m.name,
        url: "",
        titleHtml: html,
        workspaceId: m.id,
      });
    }
  }
  for (const h of index.query(needle, limit)) {
    const d = h.doc;
    const hit: UiHit = {
      key: d.id,
      kind: d.kind,
      title: d.title,
      url: d.url,
      titleHtml: h.highlights?.title ?? escapeHtml(d.title),
    };
    if (d.workspaceId !== undefined) hit.workspaceId = d.workspaceId;
    if (d.tabId !== undefined) hit.tabId = d.tabId;
    if (d.windowId !== undefined) hit.windowId = d.windowId;
    out.push(hit);
  }
  return out.slice(0, limit);
}

/** Opens a hit: tab -> activate; workspaceTab -> switch (or focus its window) then activate. */
export async function openHit(hit: UiHit): Promise<void> {
  switch (hit.kind) {
    case "workspace":
      if (hit.workspaceId) await switchTo(hit.workspaceId);
      return;
    case "tab":
      if (hit.tabId !== undefined && hit.windowId !== undefined)
        await activateTab(hit.tabId, hit.windowId);
      return;
    case "workspaceTab": {
      const ws = hit.workspaceId;
      if (!ws) return;
      const owner = owners.peek()[ws];
      const w = store.windowId.peek();
      if (owner !== undefined && owner !== w) {
        await chrome.windows.update(owner, { focused: true });
        await activateByUrl(owner, hit.url);
        return;
      }
      if ((await switchTo(ws)) && w !== null) await activateByUrl(w, hit.url);
      return;
    }
    default:
      await openUrl(hit.url);
  }
}
