/**
 * `import.bookmarks` (docs/PHASE3.md §6, worker side): plans with core's planBookmarkImport and
 * writes each import in ONE storage.local.set (atomic: nothing is half-written on failure).
 * Quick links: `quicklinks` with rev + 1 (same record `quicklink.set` writes); caller holds lane
 * `key:quicklinks`. Workspaces: ws:meta (links in `resources`, like `link.add`) + empty ws:tabs +
 * ws:index append; caller holds `key:ws:index` + `key:ws:meta` (like `workspace.create`).
 * Never touches live windows.
 */
import { planBookmarkImport } from "../core/backup/bookmarks";
import type {
  QuickLink,
  QuickLinks,
  SavedLink,
  WorkspaceMeta,
  WorkspaceTabs,
} from "../core/model/types";
import { Keys } from "../core/model/types";
import type { BookmarkEntry, ImportBookmarksReport, ImportTarget } from "../messaging/commands";
import type { BgContext } from "./context";

export async function importBookmarks(
  ctx: BgContext,
  entries: readonly BookmarkEntry[],
  target: ImportTarget,
): Promise<ImportBookmarksReport> {
  const { repo, ports } = ctx;
  const now = ports.now();
  const current = target.kind === "quicklinks" ? await repo.getQuickLinks() : null;
  const plan = planBookmarkImport(
    entries,
    target,
    { quickLinkUrls: current?.items.map((q) => q.url) ?? [] },
    ctx.classifyOptions(),
  );
  const report: ImportBookmarksReport = {
    added: plan.added,
    skipped: plan.skipped,
    workspaces: [],
    warnings: plan.warnings,
  };

  if (current) {
    if (plan.quickLinks.length === 0) return report;
    let order = current.items.reduce((m, q) => Math.max(m, q.order), -1);
    const added: QuickLink[] = plan.quickLinks.map((l) => ({
      id: ports.newId(),
      url: l.url,
      title: l.title,
      order: ++order,
    }));
    const next: QuickLinks = { items: [...current.items, ...added], rev: current.rev + 1 };
    await repo.setMany({ [Keys.quicklinks]: next });
    return report;
  }

  if (plan.workspaces.length === 0) return report;
  const color = target.kind === "quicklinks" ? "grey" : target.color;
  const writes: Record<string, unknown> = {};
  const ids: string[] = [];
  for (const ws of plan.workspaces) {
    const id = ports.newId();
    const resources: SavedLink[] = ws.links.map((l, order) => ({
      id: ports.newId(),
      url: l.url,
      title: l.title,
      order,
      addedAt: now,
    }));
    writes[Keys.wsMeta(id)] = {
      id,
      name: ws.name,
      color,
      kind: "named",
      resources,
      createdAt: now,
      updatedAt: now,
      rev: 1,
    } satisfies WorkspaceMeta;
    writes[Keys.wsTabs(id)] = { tabs: [], updatedAt: now, rev: 1 } satisfies WorkspaceTabs;
    ids.push(id);
  }
  writes[Keys.wsIndex] = [...(await repo.getWorkspaceIndex()), ...ids];
  await repo.setMany(writes);
  report.workspaces = ids;
  return report;
}
