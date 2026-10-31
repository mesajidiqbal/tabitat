/**
 * HTML export in the Netscape Bookmark File Format (docs/PHASE4.md §2), so every browser's
 * bookmark manager can import it. Pure: the worker hands in validated records.
 *
 * - "all": one folder per workspace (its tabs, then a "Saved links" sub-folder when it has
 *   links), then a "Quick links" folder when there are quick links.
 * - "generation": one folder per window of a session generation, named after its workspace
 *   when known, else "Window N".
 *
 * URLs the running browser could not restore (`classifyUrl === "skip"`: javascript:, data:,
 * foreign internal schemes, …) are left out; placeholder URLs are unwrapped when a placeholder
 * base is given; `stripQuery` drops `?query` and `#fragment` (also from a title that is itself a URL). `ADD_DATE` is in Unix seconds.
 */
import type { HtmlExport } from "../../messaging/commands";
import type {
  QuickLinks,
  SavedLink,
  SavedTab,
  SessionGeneration,
  WorkspaceMeta,
  WorkspaceTabs,
} from "../model/types";
import { classifyUrl, unwrapUrl } from "../ops/url";

export interface ExportWorkspace {
  meta: WorkspaceMeta;
  tabs: WorkspaceTabs;
  links: SavedLink[];
}

export type HtmlExportInput =
  | { kind: "all"; workspaces: ExportWorkspace[]; quicklinks: QuickLinks }
  | {
      kind: "generation";
      generation: SessionGeneration;
      /** Workspace id -> name, for windows whose workspace is still known. */
      workspaceNames?: Record<string, string>;
    };

/** Human-readable strings of the export; the worker passes translated ones (core has no i18n). */
export interface ExportLabels {
  /** `<TITLE>` of the file. */
  title: string;
  /** `<H1>` of an "all" export, followed by ` — <date>`. */
  exportHeading: string;
  /** `<H1>` of a session export, followed by ` <generation> — <date>`. */
  sessionHeading: string;
  /** Sub-folder holding a workspace's saved links. */
  savedLinks: string;
  /** Folder of the quick links. */
  quickLinks: string;
  /** Folder name of a window without a known workspace, followed by ` <n>`. */
  window: string;
}

export const DEFAULT_EXPORT_LABELS: ExportLabels = {
  title: "Tabitat export",
  exportHeading: "Tabitat export",
  sessionHeading: "Tabitat session",
  savedLinks: "Saved links",
  quickLinks: "Quick links",
  window: "Window",
};

export interface HtmlExportOptions {
  now: number;
  /** Overrides of the English defaults; a missing or empty entry keeps the default. */
  labels?: Partial<ExportLabels>;
  stripQuery?: boolean;
  /** Placeholder page URL (`chrome.runtime.getURL("suspended.html")`); unwrapped when given. */
  placeholderBase?: string;
}

/**
 * Saved links of a workspace, in their display order. Saved links live in the workspace's meta
 * record (`ws:meta:<id>.resources`), not in a record of their own.
 */
export function savedLinksOf(meta: WorkspaceMeta): SavedLink[] {
  return [...meta.resources].sort((a, b) => a.order - b.order);
}

/** `{ meta, tabs }` pairs (as the backup reads them) with their saved links attached. */
export function withSavedLinks(
  workspaces: ReadonlyArray<{ meta: WorkspaceMeta; tabs: WorkspaceTabs }>,
): ExportWorkspace[] {
  return workspaces.map((w) => ({ meta: w.meta, tabs: w.tabs, links: savedLinksOf(w.meta) }));
}

/** Escapes `& < > "` for element text and double-quoted attribute values. */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;",
  );
}

/** `url` without `?query` and `#fragment`. */
export function stripQueryAndHash(url: string): string {
  try {
    const u = new URL(url);
    u.search = "";
    u.hash = "";
    return u.href;
  } catch {
    return url.split(/[?#]/)[0] ?? url;
  }
}

/** A title that is itself an http(s) URL (tabs without a title show their URL). */
function isUrlTitle(title: string): boolean {
  const t = title.trim();
  if (!/^https?:\/\//i.test(t)) return false;
  try {
    new URL(t);
    return true;
  } catch {
    return false;
  }
}

/** UTC calendar date of `now` as YYYY-MM-DD. */
export function isoDate(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

export function exportFilename(now: number, generation?: number): string {
  return generation === undefined
    ? `tabitat-${isoDate(now)}.html`
    : `tabitat-session-${generation}-${isoDate(now)}.html`;
}

const seconds = (ms: number) => Math.max(0, Math.floor(ms / 1000));

interface Entry {
  url: string;
  title: string;
  addedAt: number;
}

interface Folder {
  name: string;
  addedAt?: number;
  entries: Entry[];
  folders: Folder[];
}

class Writer {
  private readonly lines: string[] = [];
  line(depth: number, text: string): void {
    this.lines.push(`${"  ".repeat(depth)}${text}`);
  }
  toString(): string {
    return `${this.lines.join("\n")}\n`;
  }
}

function writeFolderBody(w: Writer, depth: number, f: Folder): void {
  for (const e of f.entries) {
    w.line(
      depth,
      `<DT><A HREF="${escapeHtml(e.url)}" ADD_DATE="${seconds(e.addedAt)}">${escapeHtml(e.title)}</A>`,
    );
  }
  for (const sub of f.folders) writeFolder(w, depth, sub);
}

function writeFolder(w: Writer, depth: number, f: Folder): void {
  const date = f.addedAt === undefined ? "" : ` ADD_DATE="${seconds(f.addedAt)}"`;
  w.line(depth, `<DT><H3${date}>${escapeHtml(f.name)}</H3>`);
  w.line(depth, "<DL><p>");
  writeFolderBody(w, depth + 1, f);
  w.line(depth, "</DL><p>");
}

export function buildHtmlExport(input: HtmlExportInput, opts: HtmlExportOptions): HtmlExport {
  const entry = (url: string, title: string, addedAt: number): Entry | null => {
    const real = opts.placeholderBase ? unwrapUrl(url, opts.placeholderBase) : url;
    if (classifyUrl(real) === "skip") return null;
    const out = opts.stripQuery ? stripQueryAndHash(real) : real;
    const shown = opts.stripQuery && isUrlTitle(title) ? stripQueryAndHash(title.trim()) : title;
    return { url: out, title: shown.trim() === "" ? out : shown, addedAt };
  };
  const entries = <T>(items: readonly T[], f: (x: T) => Entry | null): Entry[] =>
    items.map(f).filter((e): e is Entry => e !== null);
  const byIndex = (tabs: readonly SavedTab[]) => [...tabs].sort((a, b) => a.index - b.index);

  const labels: ExportLabels = { ...DEFAULT_EXPORT_LABELS };
  for (const k of Object.keys(labels) as Array<keyof ExportLabels>) {
    const v = opts.labels?.[k];
    if (typeof v === "string" && v.trim() !== "") labels[k] = v;
  }
  const top: Folder[] = [];
  let heading: string;
  if (input.kind === "all") {
    heading = `${labels.exportHeading} — ${isoDate(opts.now)}`;
    for (const ws of input.workspaces) {
      const folder: Folder = {
        name: ws.meta.name,
        addedAt: ws.meta.createdAt,
        entries: entries(byIndex(ws.tabs.tabs), (t) => entry(t.url, t.title, ws.tabs.updatedAt)),
        folders: [],
      };
      const links = entries(
        [...ws.links].sort((a, b) => a.order - b.order),
        (l) => entry(l.url, l.title, l.addedAt),
      );
      if (links.length > 0)
        folder.folders.push({ name: labels.savedLinks, entries: links, folders: [] });
      top.push(folder);
    }
    const quick = entries(
      [...input.quicklinks.items].sort((a, b) => a.order - b.order),
      (q) => entry(q.url, q.title, opts.now),
    );
    if (quick.length > 0) top.push({ name: labels.quickLinks, entries: quick, folders: [] });
  } else {
    const g = input.generation;
    heading = `${labels.sessionHeading} ${g.id} — ${isoDate(opts.now)}`;
    g.windows.forEach((win, i) => {
      const names = input.workspaceNames;
      const known =
        win.workspaceId !== null && names && Object.hasOwn(names, win.workspaceId)
          ? names[win.workspaceId]
          : undefined;
      top.push({
        name: known ?? `${labels.window} ${i + 1}`,
        addedAt: g.takenAt,
        entries: entries(byIndex(win.tabs), (t) => entry(t.url, t.title, g.takenAt)),
        folders: [],
      });
    });
  }

  const w = new Writer();
  w.line(0, "<!DOCTYPE NETSCAPE-Bookmark-file-1>");
  w.line(0, '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">');
  w.line(0, `<TITLE>${escapeHtml(labels.title)}</TITLE>`);
  w.line(0, `<H1>${escapeHtml(heading)}</H1>`);
  w.line(0, "<DL><p>");
  for (const f of top) writeFolder(w, 1, f);
  w.line(0, "</DL><p>");
  return {
    html: w.toString(),
    filename: exportFilename(
      opts.now,
      input.kind === "generation" ? input.generation.id : undefined,
    ),
  };
}
