/**
 * Registers every RPC command (src/messaging/commands.ts) on the CommandRouter, with its payload
 * schema (src/messaging/schemas.ts), lanes and handler. Record edits check `expectedRev`
 * (conflict) and bump `rev`; they ack only after storage.local.set resolved.
 */
import { buildBackup } from "../core/backup";
import {
  buildHtmlExport,
  DEFAULT_EXPORT_LABELS,
  type ExportLabels,
  withSavedLinks,
} from "../core/export/html";
import { parseSettings } from "../core/model/schemas";
import type {
  Note,
  QuickLinks,
  SavedLink,
  Settings,
  TodoList,
  WorkspaceMeta,
} from "../core/model/types";
import { Keys, LIMITS } from "../core/model/types";
import {
  captureUrl,
  classifyUrl,
  isBlankPageUrl,
  normalizeForMatch,
  unwrapUrl,
} from "../core/ops/url";
import { nextLocalUpdatedAt } from "../core/sync/settings";
import { RpcError } from "../messaging/errors";
import { PayloadSchemas } from "../messaging/schemas";
import { evaluateBackupReminder, recordBackup, snoozeBackupReminder } from "./backup-reminder";
import { importBookmarks } from "./bookmarks-import";
import type { CommandRouter } from "./command-router";
import { BG_PREFIX, BgKeys } from "./keys";
import { Lane } from "./lanes";
import { repairAlarms } from "./ready";
import type { Services } from "./services";
import { TAB_MOVED_MESSAGE } from "./suspender";
import { removeTabsSafely } from "./tab-utils";
import { switchLanes } from "./workspace-engine";

/** i18n message keys of the HTML export labels (public/_locales/<lang>/messages.json). */
export const EXPORT_LABEL_KEYS: Record<keyof ExportLabels, string> = {
  title: "exportTitle",
  exportHeading: "exportHeading",
  sessionHeading: "exportSessionHeading",
  savedLinks: "exportSavedLinks",
  quickLinks: "exportQuickLinks",
  window: "exportWindow",
};

/** Translated export labels; an empty or missing message keeps the English default. */
export function exportLabels(runtime: { getMessage?(key: string): string }): ExportLabels {
  const out: ExportLabels = { ...DEFAULT_EXPORT_LABELS };
  for (const k of Object.keys(EXPORT_LABEL_KEYS) as Array<keyof ExportLabels>) {
    const msg = runtime.getMessage?.(EXPORT_LABEL_KEYS[k]);
    if (typeof msg === "string" && msg.trim() !== "") out[k] = msg;
  }
  return out;
}

function checkRev(current: number, expected: number | undefined, what: string): void {
  if (expected !== undefined && expected !== current) {
    throw new RpcError("conflict", `${what} changed (rev ${current}, expected ${expected})`);
  }
}

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

export async function purgeExpiredTrash(s: Services): Promise<number> {
  const { repo, ports } = s.ctx;
  const trash = await repo.getTrash();
  const cutoff = ports.now() - LIMITS.trashRetentionMs;
  const keep = trash.items.filter((i) => i.deletedAt >= cutoff);
  if (keep.length === trash.items.length) return 0;
  await repo.setMany({ [Keys.trash]: { items: keep } });
  return trash.items.length - keep.length;
}

export function registerHandlers(router: CommandRouter, s: Services): void {
  const { ctx, engine } = s;
  const { repo, ports } = ctx;
  const S = PayloadSchemas;

  const metaOrThrow = async (id: string): Promise<WorkspaceMeta> => {
    const meta = await repo.getWorkspaceMeta(id);
    if (!meta) throw new RpcError("not_found", `workspace ${id} not found`);
    return meta;
  };
  /** A workspace scope that still exists, else "global". */
  const restoreScope = async (scope: string): Promise<string> =>
    scope === "global" || (await repo.getWorkspaceMeta(scope)) ? scope : "global";
  const scopeOrThrow = async (scope: string): Promise<void> => {
    if (scope !== "global") await metaOrThrow(scope);
  };

  // ---------------------------------------------------------------- workspaces
  router.register(
    "workspace.create",
    S["workspace.create"],
    (p) => engine.createWorkspace(p.name, p.color, p.fromWindowId),
    (p) =>
      p.fromWindowId === undefined
        ? [Lane.wsIndex, Lane.wsMeta]
        : [Lane.wsIndex, Lane.wsMeta, Lane.window(p.fromWindowId)],
  );

  router.register(
    "workspace.update",
    S["workspace.update"],
    async (p) => {
      const meta = await metaOrThrow(p.id);
      checkRev(meta.rev, p.expectedRev, "workspace");
      const next: WorkspaceMeta = { ...meta, updatedAt: ports.now(), rev: meta.rev + 1 };
      if (p.patch.name !== undefined) {
        next.name = p.patch.name;
        // Naming an Unsorted workspace makes it a regular one.
        if (meta.kind === "unsorted") next.kind = "named";
      }
      if (p.patch.color !== undefined) next.color = p.patch.color;
      if (p.patch.emoji !== undefined) {
        if (p.patch.emoji === "") delete next.emoji;
        else next.emoji = p.patch.emoji;
      }
      await repo.setMany({ [Keys.wsMeta(p.id)]: next });
      return next;
    },
    () => [Lane.wsMeta],
  );

  router.register(
    "workspace.reorder",
    S["workspace.reorder"],
    async (p) => {
      const cur = await repo.getWorkspaceIndex();
      const a = [...cur].sort();
      const b = [...p.ids].sort();
      if (a.length !== b.length || a.some((x, i) => x !== b[i])) {
        throw new RpcError("invalid", "ids must be a permutation of the current workspaces");
      }
      await repo.setMany({ [Keys.wsIndex]: p.ids });
      return null;
    },
    () => [Lane.wsIndex],
  );

  router.register(
    "workspace.delete",
    S["workspace.delete"],
    (p) => engine.deleteWorkspace(p.id),
    () => [Lane.wsIndex, Lane.wsMeta, Lane.trash],
  );

  router.register(
    "workspace.switch",
    S["workspace.switch"],
    (p) => engine.switchWorkspace(p.windowId, p.workspaceId),
    (p) => switchLanes(p.windowId),
    { exclusive: (p) => `switch:${p.windowId}` },
  );

  router.register(
    "workspace.open",
    S["workspace.open"],
    (p) => engine.openInNewWindow(p.workspaceId),
    () => [Lane.wsIndex, Lane.wsMeta],
  );

  router.register(
    "workspace.next",
    S["workspace.next"],
    (p) => engine.nextWorkspace(p.windowId, p.direction),
    (p) => switchLanes(p.windowId),
    { exclusive: (p) => `switch:${p.windowId}` },
  );

  // ---------------------------------------------------------------- links
  /**
   * Appends a saved link; idempotent per URL: when the workspace already has a link whose
   * (unwrapped, normalized) URL matches, that link is returned unchanged (no write, no rev bump).
   */
  const addLink = async (workspaceId: string, url: string, title: string): Promise<SavedLink> => {
    const meta = await metaOrThrow(workspaceId);
    const key = (u: string) => normalizeForMatch(unwrapUrl(u, ctx.placeholderBase));
    const want = key(url);
    const existing = meta.resources.find((r) => key(r.url) === want);
    if (existing) return existing;
    const link: SavedLink = {
      id: ports.newId(),
      url,
      title,
      order: meta.resources.reduce((m, r) => Math.max(m, r.order), -1) + 1,
      addedAt: ports.now(),
    };
    await repo.setMany({
      [Keys.wsMeta(workspaceId)]: {
        ...meta,
        resources: [...meta.resources, link],
        updatedAt: ports.now(),
        rev: meta.rev + 1,
      } satisfies WorkspaceMeta,
    });
    return link;
  };

  router.register(
    "link.add",
    S["link.add"],
    (p) => addLink(p.workspaceId, p.url, p.title),
    () => [Lane.wsMeta],
  );

  router.register(
    "link.remove",
    S["link.remove"],
    async (p) => {
      const meta = await metaOrThrow(p.workspaceId);
      const link = meta.resources.find((r) => r.id === p.linkId);
      if (!link) throw new RpcError("not_found", `link ${p.linkId} not found`);
      const trash = await repo.getTrash();
      const trashId = ports.newId();
      trash.items.push({
        id: trashId,
        kind: "link",
        deletedAt: ports.now(),
        workspaceId: p.workspaceId,
        link,
      });
      await repo.setMany({
        [Keys.trash]: trash,
        [Keys.wsMeta(p.workspaceId)]: {
          ...meta,
          resources: meta.resources.filter((r) => r.id !== p.linkId),
          updatedAt: ports.now(),
          rev: meta.rev + 1,
        } satisfies WorkspaceMeta,
      });
      return { trashId };
    },
    () => [Lane.wsMeta, Lane.trash],
  );

  router.register(
    "tabs.park",
    S["tabs.park"],
    async (p) => {
      const tab = await ports.tabs.get(p.tabId);
      if (!tab) throw new RpcError("not_found", `tab ${p.tabId} not found`);
      const url = unwrapUrl(captureUrl(tab), ctx.placeholderBase);
      if (isBlankPageUrl(url) || classifyUrl(url, ctx.classifyOptions()) === "skip") {
        throw new RpcError("invalid", "this tab's address cannot be saved");
      }
      // Save first, then close (never lose the tab). Already saved: the existing link is
      // returned and the tab is still closed.
      const link = await addLink(p.workspaceId, url, tab.title);
      await removeTabsSafely(ports.tabs, [p.tabId]);
      return link;
    },
    () => [Lane.wsMeta],
  );

  // ---------------------------------------------------------------- tabs
  router.register(
    "tabs.suspendOthers",
    S["tabs.suspendOthers"],
    (p) => s.suspender.suspendOthers(p.windowId),
    (p) => [Lane.window(p.windowId)],
  );

  router.register(
    "tabs.suspend",
    S["tabs.suspend"],
    async (p) => {
      // The lane depends on the tab's window, which only a lookup can tell: resolve it here
      // (holding no lane), then run in window:<id>; suspendOne re-reads the tab inside and
      // refuses (busy, TAB_MOVED_MESSAGE) when it moved meanwhile: retry once under the new
      // window's lane, then let the error propagate (busy is retryable for the UI).
      const attempt = async (retries: number): Promise<null> => {
        const tab = await ports.tabs.get(p.tabId);
        if (!tab) throw new RpcError("not_found", `tab ${p.tabId} not found`);
        try {
          return await ctx.lanes.run([Lane.window(tab.windowId)], () =>
            s.suspender.suspendOne(p.tabId, tab.windowId),
          );
        } catch (e) {
          const moved = e instanceof RpcError && e.message === TAB_MOVED_MESSAGE;
          if (moved && retries > 0) return attempt(retries - 1);
          throw e;
        }
      };
      return attempt(1);
    },
    () => [],
  );

  router.register(
    "tabs.closeDuplicates",
    S["tabs.closeDuplicates"],
    (p) => s.suspender.closeDuplicates(p.windowId),
    (p) => (p.windowId === undefined ? ["tabs:all"] : [Lane.window(p.windowId), "tabs:all"]),
  );

  // ---------------------------------------------------------------- sessions / backup
  router.register(
    "session.restore",
    S["session.restore"],
    async (p) => {
      const out = await s.sessionGuard.restore(p.generation);
      // The user acted on the recovery screen: the "window not restored" hint is done.
      await repo.remove(BgKeys.recoveryHint).catch((e) => ctx.log.warn(e));
      return out;
    },
    () => [Lane.sessions],
  );

  router.register(
    "session.snapshotNow",
    S["session.snapshotNow"],
    async () => {
      const generation = await s.sessionGuard.take({ force: true });
      if (generation === null) throw new RpcError("invalid", "no open tabs to snapshot");
      return { generation };
    },
    () => [Lane.sessions],
  );

  /** Stamps `meta.lastBackupAt` and clears the reminder; never fails the export itself. */
  const stampBackup = async (): Promise<void> => {
    // A degraded worker (init failed) still exports, but writes nothing.
    if (s.barrier.isDegraded) return;
    await recordBackup(ctx).catch((e) => ctx.log.warn("[tabitat] recording the backup failed", e));
  };

  router.register(
    "backup.export",
    S["backup.export"],
    async () => {
      const file = await s.backup.exportBackup();
      await stampBackup();
      return file;
    },
    () => [Lane.global],
  );

  router.register(
    "backup.exportHtml",
    S["backup.exportHtml"],
    async (p) => {
      const now = ports.now();
      // Same source as the JSON export (salvaged records, index order + unindexed metas).
      const { data } = buildBackup(await repo.getAll(), now);
      const out = buildHtmlExport(
        { kind: "all", workspaces: withSavedLinks(data.workspaces), quicklinks: data.quicklinks },
        {
          now,
          stripQuery: p.stripQuery === true,
          placeholderBase: ctx.placeholderBase,
          labels: exportLabels(ports.runtime),
        },
      );
      await stampBackup();
      return out;
    },
    () => [Lane.global],
  );

  router.register(
    "session.exportHtml",
    S["session.exportHtml"],
    async (p) => {
      const generation = await repo.getSessionGen(p.generation);
      if (!generation) throw new RpcError("not_found", `session ${p.generation} not found`);
      const workspaceNames: Record<string, string> = {};
      for (const id of new Set(generation.windows.map((w) => w.workspaceId))) {
        if (id === null) continue;
        const meta = await repo.getWorkspaceMeta(id);
        if (meta) workspaceNames[id] = meta.name;
      }
      return buildHtmlExport(
        { kind: "generation", generation, workspaceNames },
        {
          now: ports.now(),
          stripQuery: p.stripQuery === true,
          placeholderBase: ctx.placeholderBase,
          labels: exportLabels(ports.runtime),
        },
      );
    },
    () => [Lane.sessions],
  );

  router.register(
    "reminder.snooze",
    S["reminder.snooze"],
    async (p) => {
      await snoozeBackupReminder(ctx, p.days);
      return null;
    },
    () => [Lane.global],
  );

  router.register(
    "backup.import",
    S["backup.import"],
    (p) => s.backup.importBackup(p.file, p.mode),
    () => [Lane.global],
  );

  // ---------------------------------------------------------------- records
  router.register(
    "todo.set",
    S["todo.set"],
    async (p) => {
      await scopeOrThrow(p.scope);
      const cur = await repo.getTodos(p.scope);
      const rev = cur?.rev ?? 0;
      checkRev(rev, p.expectedRev, "todos");
      const next: TodoList = { items: p.items, rev: rev + 1 };
      await repo.setMany({ [Keys.todos(p.scope)]: next });
      return { rev: next.rev };
    },
    (p) => [Lane.key(Keys.todos(p.scope))],
  );

  router.register(
    "note.set",
    S["note.set"],
    async (p) => {
      await scopeOrThrow(p.scope);
      const cur = await repo.getNote(p.scope);
      const rev = cur?.rev ?? 0;
      checkRev(rev, p.expectedRev, "note");
      const next: Note = { content: p.content, updatedAt: ports.now(), rev: rev + 1 };
      await repo.setMany({ [Keys.notes(p.scope)]: next });
      return next;
    },
    (p) => [Lane.key(Keys.notes(p.scope))],
  );

  router.register(
    "quicklink.set",
    S["quicklink.set"],
    async (p) => {
      const cur = await repo.getQuickLinks();
      checkRev(cur.rev, p.expectedRev, "quick links");
      const next: QuickLinks = { items: p.items, rev: cur.rev + 1 };
      await repo.setMany({ [Keys.quicklinks]: next });
      return { rev: next.rev };
    },
    () => [Lane.key(Keys.quicklinks)],
  );

  router.register(
    "settings.update",
    S["settings.update"],
    async (p) => {
      const cur = await repo.getSettings();
      checkRev(cur.rev, p.expectedRev, "settings");
      const merged: Record<string, unknown> = { ...cur };
      for (const [k, val] of Object.entries(p.patch)) {
        const prev = merged[k];
        merged[k] = isPlainObject(prev) && isPlainObject(val) ? { ...prev, ...val } : val;
      }
      merged.rev = cur.rev + 1;
      merged.updatedAt = nextLocalUpdatedAt(ports.now(), cur.updatedAt);
      const next: Settings = parseSettings(merged);
      await repo.setMany({ [Keys.settings]: next });
      const recreate =
        next.sessions.everyMinutes !== cur.sessions.everyMinutes ? ["session-gen"] : [];
      await repairAlarms(ctx, next, recreate).catch((e) => ctx.log.warn(e));
      // A new cadence (or "off") is applied to the reminder right away.
      if (next.backupReminderDays !== cur.backupReminderDays) {
        await evaluateBackupReminder(ctx, next).catch((e) => ctx.log.warn(e));
      }
      // Sync (push; turning it on pulls first, and an applied pull repairs alarms itself).
      // Never fails the update: errors are recorded in sync:status.
      return s.settingsSync.afterUpdate(cur, next).catch((e: unknown) => {
        ctx.log.warn("[tabitat] settings sync failed", e);
        return next;
      });
    },
    () => [Lane.key(Keys.settings), Lane.key(BgKeys.backupReminder)],
  );

  router.register(
    "settings.syncNow",
    S["settings.syncNow"],
    () => s.settingsSync.syncNow(),
    // A pulled cadence change re-evaluates the backup reminder.
    () => [Lane.key(Keys.settings), Lane.key(BgKeys.backupReminder)],
  );

  // ---------------------------------------------------------------- bookmarks import
  router.register(
    "import.bookmarks",
    S["import.bookmarks"],
    (p) => importBookmarks(ctx, p.entries, p.target),
    (p) =>
      p.target.kind === "quicklinks" ? [Lane.key(Keys.quicklinks)] : [Lane.wsIndex, Lane.wsMeta],
  );

  // ---------------------------------------------------------------- trash
  router.register(
    "trash.restore",
    S["trash.restore"],
    async (p) => {
      const trash = await repo.getTrash();
      const item = trash.items.find((i) => i.id === p.trashId);
      if (!item) throw new RpcError("not_found", `trash item ${p.trashId} not found`);
      const rest = { items: trash.items.filter((i) => i.id !== p.trashId) };
      if (item.kind === "workspace") {
        let id = item.meta.id;
        if (await repo.getWorkspaceMeta(id)) id = ports.newId();
        const index = await repo.getWorkspaceIndex();
        const { windowHint: _drop, ...meta } = item.meta;
        await repo.setMany({
          [Keys.wsMeta(id)]: { ...meta, id, updatedAt: ports.now(), rev: item.meta.rev + 1 },
          [Keys.wsTabs(id)]: item.tabs,
          [Keys.wsIndex]: [...index, id],
          [Keys.trash]: rest,
        });
      } else if (item.kind === "note") {
        // Into its scope (or "global" when that workspace is gone); never over other content.
        const scope = await restoreScope(item.scope);
        const cur = await repo.getNote(scope);
        const content =
          cur && cur.content.trim() !== "" && cur.content !== item.note.content
            ? `${cur.content}\n\n${item.note.content}`
            : item.note.content;
        await repo.setMany({
          [Keys.notes(scope)]: {
            content,
            updatedAt: ports.now(),
            rev: (cur?.rev ?? 0) + 1,
          } satisfies Note,
          [Keys.trash]: rest,
        });
      } else if (item.kind === "todos") {
        const scope = await restoreScope(item.scope);
        const cur = await repo.getTodos(scope);
        const have = cur?.items ?? [];
        const taken = new Set(have.map((t) => t.id));
        let order = have.reduce((m, t) => Math.max(m, t.order), -1);
        const added = item.list.items.map((t) => {
          let id = t.id;
          while (taken.has(id)) id = ports.newId();
          taken.add(id);
          return { ...t, id, order: ++order };
        });
        await repo.setMany({
          [Keys.todos(scope)]: {
            items: [...have, ...added],
            rev: (cur?.rev ?? 0) + 1,
          } satisfies TodoList,
          [Keys.trash]: rest,
        });
      } else {
        const meta = await repo.getWorkspaceMeta(item.workspaceId);
        if (!meta) throw new RpcError("not_found", "the link's workspace no longer exists");
        const order = meta.resources.reduce((m, r) => Math.max(m, r.order), -1) + 1;
        await repo.setMany({
          [Keys.wsMeta(meta.id)]: {
            ...meta,
            resources: [...meta.resources, { ...item.link, order }],
            updatedAt: ports.now(),
            rev: meta.rev + 1,
          } satisfies WorkspaceMeta,
          [Keys.trash]: rest,
        });
      }
      return null;
    },
    // Restores may write any ws/notes/todos record: exclusive (rare, user-initiated).
    () => [Lane.global],
  );

  router.register(
    "trash.purge",
    S["trash.purge"],
    async (p) => {
      const trash = await repo.getTrash();
      if (p.trashId === undefined) {
        if (trash.items.length > 0) await repo.setMany({ [Keys.trash]: { items: [] } });
        return trash.items.length;
      }
      if (!trash.items.some((i) => i.id === p.trashId)) {
        throw new RpcError("not_found", `trash item ${p.trashId} not found`);
      }
      await repo.setMany({
        [Keys.trash]: { items: trash.items.filter((i) => i.id !== p.trashId) },
      });
      return 1;
    },
    () => [Lane.trash],
  );

  // ---------------------------------------------------------------- pomodoro
  const pomodoroLane = () => [Lane.key(Keys.pomodoro)];
  router.register("pomodoro.start", S["pomodoro.start"], () => s.pomodoro.start(), pomodoroLane);
  router.register("pomodoro.stop", S["pomodoro.stop"], () => s.pomodoro.stop(), pomodoroLane);
  router.register("pomodoro.skip", S["pomodoro.skip"], () => s.pomodoro.skip(), pomodoroLane);

  // ---------------------------------------------------------------- status
  router.register(
    "op.status",
    S["op.status"],
    async (p) => engine.status(p.windowId) ?? (await repo.getOp(p.windowId)),
    () => [],
  );

  // ---------------------------------------------------------------- recovery screen
  router.register(
    "recovery.dismiss",
    S["recovery.dismiss"],
    async (p) => {
      const pending = await repo.getRecoveryPending();
      const drop = p.opIds === undefined ? null : new Set(p.opIds);
      const keep = drop === null ? [] : pending.entries.filter((e) => !drop.has(e.opId));
      const removed = pending.entries.length - keep.length;
      if (removed === 0) return 0;
      if (keep.length === 0) await repo.remove(BgKeys.recoveryPending);
      else await repo.setMany({ [BgKeys.recoveryPending]: { entries: keep } });
      return removed;
    },
    // abandon() appends entries from inside a switch's lanes: exclusive (rare, user-initiated).
    () => [Lane.global],
  );

  router.register(
    "recovery.dismissHint",
    S["recovery.dismissHint"],
    async () => {
      await repo.remove(BgKeys.recoveryHint);
      return null;
    },
    () => [Lane.global],
  );

  router.register(
    "system.purgeCorrupt",
    S["system.purgeCorrupt"],
    async (p) => {
      const keys = p.keys ?? Object.keys(await repo.listRaw(BG_PREFIX.corrupt));
      if (keys.length === 0) return 0;
      await repo.remove([...new Set(keys)]);
      return new Set(keys).size;
    },
    () => [Lane.global],
  );

  router.register(
    "system.ping",
    S["system.ping"],
    async () => {
      const st = s.barrier.state;
      return st?.degraded
        ? { epoch: ctx.epoch, ready: true as const, degraded: true, error: st.error }
        : { epoch: ctx.epoch, ready: true as const };
    },
    () => [],
  );
}
