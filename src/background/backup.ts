/**
 * Export / import (ARCHITECTURE §6). An import is bounded (size/workspaces/tabs), validated,
 * and for `replace` made reversible first: a full session generation is written and every
 * existing workspace is archived in the trash; windows showing a replaced workspace are detached
 * (their live tabs become Unsorted). The full write set is then staged under `import:staging`
 * (with the `rev` of every record it touches) and applied. Staging is an exclusive transaction:
 * until it is resolved nothing else writes (init resolves it before any command runs), and a
 * replay never overwrites a ws/todos/notes record edited after staging (higher `rev`). A staged
 * import that fails twice is moved to `import:failed` so the extension is never bricked.
 */
import * as v from "valibot";
import { buildBackup, checkBackupLimits, planImport, validateBackup } from "../core/backup";
import { isValidId } from "../core/model/id";
import {
  isNote,
  isQuickLinks,
  isSettings,
  isTodoList,
  isTrash,
  isWorkspaceMeta,
  isWorkspaceTabs,
  WorkspaceIndexSchema,
} from "../core/model/schemas";
import type { BackupFile, WindowState } from "../core/model/types";
import { KEY_PREFIX, Keys } from "../core/model/types";
import type { ImportReport } from "../messaging/commands";
import { RpcError } from "../messaging/errors";
import type { BgContext } from "./context";
import { BgKeys } from "./keys";
import { hasOwnKey, isRecord, ownGet } from "./own";

/** Families a staged import may write (D5). Value validators per family. */
const STAGING_FAMILIES: Array<{
  match: (k: string) => string | null;
  ok: (v: unknown) => boolean;
}> = [
  { match: (k) => (k === Keys.wsIndex ? "" : null), ok: (x) => v.is(WorkspaceIndexSchema, x) },
  { match: (k) => prefixed(k, KEY_PREFIX.wsMeta), ok: isWorkspaceMeta },
  { match: (k) => prefixed(k, KEY_PREFIX.wsTabs), ok: isWorkspaceTabs },
  { match: (k) => prefixed(k, KEY_PREFIX.todos), ok: isTodoList },
  { match: (k) => prefixed(k, KEY_PREFIX.notes), ok: isNote },
  { match: (k) => (k === Keys.quicklinks ? "" : null), ok: isQuickLinks },
  { match: (k) => (k === Keys.settings ? "" : null), ok: isSettings },
  { match: (k) => (k === Keys.trash ? "" : null), ok: isTrash },
];

function prefixed(k: string, prefix: string): string | null {
  if (!k.startsWith(prefix)) return null;
  const id = k.slice(prefix.length);
  return id === "global" || isValidId(id) ? id : null;
}

const familyOf = (k: string) => STAGING_FAMILIES.find((f) => f.match(k) !== null);
export const isStagingKey = (k: string): boolean => familyOf(k) !== undefined;

/** Records whose replay is revision-guarded (every family that carries a `rev`). */
const isRevGuarded = (k: string) =>
  k === Keys.settings ||
  k === Keys.quicklinks ||
  [KEY_PREFIX.wsMeta, KEY_PREFIX.wsTabs, KEY_PREFIX.todos, KEY_PREFIX.notes].some((p) =>
    k.startsWith(p),
  );

/** Staging written before revision guards existed: replaying it blind could undo later edits. */
export class LegacyStagingError extends Error {
  override readonly name = "LegacyStagingError";
  readonly reason = "legacy_staging";
  constructor() {
    super("staged import has no baseRevs (written by an older version); not applied");
  }
}

const StagingKey = v.pipe(
  v.string(),
  v.check((k: string) => isStagingKey(k), "key outside the import families"),
);

export const StagingSchema = v.object({
  set: v.pipe(
    v.record(StagingKey, v.unknown()),
    v.check(
      (set: Record<string, unknown>) =>
        Object.entries(set).every(([k, val]) => familyOf(k)?.ok(val) === true),
      "invalid staged record",
    ),
  ),
  remove: v.array(StagingKey),
  /** rev of each guarded key when staging was written (-1: absent). Missing = legacy staging. */
  baseRevs: v.optional(v.record(v.string(), v.number())),
  /** Keys already written (set) or removed by an earlier apply attempt, in order. */
  progress: v.optional(v.array(v.string())),
  startedAt: v.number(),
});

export type Staging = v.InferOutput<typeof StagingSchema>;

function revOf(x: unknown): number | null {
  return isRecord(x) && typeof x.rev === "number" ? x.rev : null;
}

export interface BackupDeps {
  markDirty?(windowId: number): void;
  /** Snapshot a detached window right away (caller holds every lane: global). */
  snapshotNow?(windowId: number): Promise<unknown>;
  /** Forced session generation of every live window. */
  takeGeneration?(): Promise<unknown>;
  hasRunningOps?(): boolean;
}

/** Outcome of resolving a staged import. */
export interface Resolution {
  outcome: "none" | "applied" | "failed";
  /** When failed: keys an earlier attempt had already written/removed (partial application). */
  applied?: string[];
  reason?: string;
}

export class BackupService {
  /**
   * True while `import:staging` may exist in this worker (set before it is written, cleared
   * once it is applied or moved to `import:failed`). Mutating commands answer `busy` meanwhile.
   */
  private stagingOpen = false;

  constructor(
    private readonly ctx: BgContext,
    private readonly deps: BackupDeps = {},
  ) {}

  /**
   * Null when writes may proceed; otherwise why not. An open staged import is re-attempted first
   * (it may have been a transient failure).
   */
  async blockingReason(): Promise<string | null> {
    if (!this.stagingOpen) return null;
    try {
      await this.resolveStaged();
    } catch (e) {
      this.ctx.log.warn("[tabitat] staged import still unresolved", e);
    }
    return this.stagingOpen ? "an import is still being applied; try again shortly" : null;
  }

  async exportBackup(): Promise<BackupFile> {
    return buildBackup(await this.ctx.repo.getAll(), this.ctx.ports.now());
  }

  async importBackup(file: unknown, mode: "replace" | "merge"): Promise<ImportReport> {
    const { repo, ports } = this.ctx;
    let bytes: number;
    try {
      bytes = new TextEncoder().encode(JSON.stringify(file) ?? "").length;
    } catch {
      throw new RpcError("invalid", "backup file is not serializable");
    }
    const tooBig = checkBackupLimits(file, bytes);
    if (tooBig) throw new RpcError("limit", tooBig);
    const parsed = validateBackup(file);
    if (this.deps.hasRunningOps?.() || (await repo.listOps()).length > 0) {
      throw new RpcError("busy", "a workspace switch is pending; try again when it finishes");
    }
    // An earlier staged import is resolved first (applied, or set aside to import:failed).
    await this.resolveStaged();
    const existing = await repo.getAll();
    const now = ports.now();
    const plan = planImport(parsed, existing, mode, { newId: ports.newId, now });

    const detach: number[] = [];
    if (mode === "replace") {
      // 1. Reversible: a full session generation, then every existing workspace to the trash.
      await this.deps.takeGeneration?.();
      const backup = buildBackup(existing, now).data;
      const archived = backup.workspaces;
      const trash = await repo.getTrash();
      const before = trash.items.length;
      for (const w of archived) {
        trash.items.push({
          id: ports.newId(),
          kind: "workspace",
          deletedAt: now,
          meta: w.meta,
          tabs: w.tabs,
        });
      }
      // Notes and todo lists the import removes or overwrites are archived too (T4).
      const touched = (key: string) => plan.remove.includes(key) || hasOwnKey(plan.set, key);
      for (const [scope, note] of Object.entries(backup.notes)) {
        if (note.content.trim() === "" || !touched(Keys.notes(scope))) continue;
        trash.items.push({ id: ports.newId(), kind: "note", deletedAt: now, scope, note });
      }
      for (const [scope, list] of Object.entries(backup.todos)) {
        if (list.items.length === 0 || !touched(Keys.todos(scope))) continue;
        trash.items.push({ id: ports.newId(), kind: "todos", deletedAt: now, scope, list });
      }
      if (trash.items.length > before) await repo.setMany({ [Keys.trash]: trash });
      // 2. Windows showing a replaced workspace (surviving ids included) are detached: imported
      //    data stays closed until opened; the live tabs are adopted as Unsorted.
      const replaced = new Set(archived.map((w) => w.meta.id));
      const writes: Record<string, unknown> = {};
      for (const [windowId, st] of await repo.listWindowStates()) {
        if (st.activeWorkspaceId === null || !replaced.has(st.activeWorkspaceId)) continue;
        writes[Keys.window(windowId)] = {
          activeWorkspaceId: null,
          sessionEpoch: st.sessionEpoch,
        } satisfies WindowState;
        detach.push(windowId);
      }
      if (detach.length > 0) await repo.setMany(writes);
    }

    const baseRevs: Record<string, number> = {};
    for (const k of [...Object.keys(plan.set), ...plan.remove]) {
      if (isRevGuarded(k)) baseRevs[k] = revOf(ownGet(existing, k)) ?? -1;
    }
    this.stagingOpen = true;
    await repo.setMany({
      [Keys.importStaging]: {
        set: plan.set,
        remove: plan.remove,
        baseRevs,
        progress: [],
        startedAt: now,
      },
    });
    const res = await this.resolveStaged();
    if (res.outcome === "failed") {
      const applied = res.applied ?? [];
      throw new RpcError(
        "internal",
        applied.length > 0
          ? `the import was partially applied (${applied.length} records); details in import:failed`
          : "the import could not be applied; nothing was changed",
        true,
        { partial: applied.length > 0, applied },
      );
    }
    for (const w of detach) await this.adopt(w);
    return plan.report;
  }

  /** Detached window: snapshot it now (Unsorted), or let the tracker do it. */
  private async adopt(windowId: number): Promise<void> {
    try {
      if (this.deps.snapshotNow) await this.deps.snapshotNow(windowId);
      else this.deps.markDirty?.(windowId);
    } catch (e) {
      this.ctx.log.warn("[tabitat] adopting detached window failed", windowId, e);
      this.deps.markDirty?.(windowId);
    }
  }

  /**
   * Resolves a staged import, if any: apply it (two attempts); if both fail — or it is legacy
   * staging without revision guards — move it to `import:failed` (with the error, the reason and
   * the keys already applied) so normal operation continues. Throws only when even that move
   * fails (the staged import then still blocks writes; at init, init stays degraded).
   */
  async resolveStaged(): Promise<Resolution> {
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const applied = await this.applyStaged();
        this.stagingOpen = false;
        return { outcome: applied ? "applied" : "none" };
      } catch (e) {
        lastError = e;
        this.ctx.log.warn("[tabitat] applying staged import failed", attempt + 1, e);
        if (e instanceof LegacyStagingError) break;
      }
    }
    const { repo, ports } = this.ctx;
    const raw = await repo.store.get(Keys.importStaging);
    const progress =
      isRecord(raw) && Array.isArray(raw.progress)
        ? raw.progress.filter((k): k is string => typeof k === "string")
        : [];
    const reason = lastError instanceof LegacyStagingError ? lastError.reason : "apply_failed";
    await repo.setMany({
      [BgKeys.importFailed]: {
        staging: raw ?? null,
        reason,
        error: lastError instanceof Error ? lastError.message : String(lastError),
        partial: progress.length > 0,
        applied: progress,
        at: ports.now(),
      },
    });
    await repo.remove(Keys.importStaging);
    this.stagingOpen = false;
    return { outcome: "failed", applied: progress, reason };
  }

  /**
   * Applies a staged import if one exists (revision-aware; also called by init after a crash).
   * Returns false when there is none (or it was invalid and quarantined).
   */
  async applyStaged(): Promise<boolean> {
    const { repo } = this.ctx;
    const raw = await repo.store.get(Keys.importStaging);
    if (raw === undefined) return false;
    const res = v.safeParse(StagingSchema, raw);
    if (!res.success) {
      await repo.quarantine(Keys.importStaging, raw, new Error("invalid import staging record"));
      return false;
    }
    const staged = res.output;
    if (staged.baseRevs === undefined) throw new LegacyStagingError();
    const baseRevs = staged.baseRevs;
    const done = new Set(staged.progress ?? []);
    const curIndexRaw = await repo.store.get<unknown>(Keys.wsIndex);
    const curIndex = Array.isArray(curIndexRaw)
      ? curIndexRaw.filter((id): id is string => isValidId(id))
      : [];
    const keys = [
      ...new Set([
        ...Object.keys(staged.set),
        ...staged.remove,
        ...curIndex.map((id) => Keys.wsMeta(id)),
      ]),
    ];
    const current = await repo.store.getMany(keys);
    const newer = (k: string): boolean => {
      if (!isRevGuarded(k)) return false;
      const cur = revOf(ownGet(current, k));
      return cur !== null && cur > (ownGet(baseRevs, k) ?? -1);
    };
    const set: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(staged.set)) {
      if (done.has(k) && k !== Keys.wsIndex) continue; // written by an earlier attempt
      if (newer(k)) {
        this.ctx.log.warn("[tabitat] import replay keeps a newer record", k);
        continue;
      }
      set[k] = val;
    }
    const remove = staged.remove.filter(
      (k) => !hasOwnKey(staged.set, k) && !done.has(k) && !newer(k),
    );
    // The index: the staged one plus any current workspace whose meta survives the replay
    // (created or edited after staging), so nothing becomes unreachable.
    if (hasOwnKey(set, Keys.wsIndex)) {
      const removed = new Set(remove);
      const extra = curIndex.filter(
        (id) =>
          !removed.has(Keys.wsMeta(id)) &&
          (hasOwnKey(current, Keys.wsMeta(id)) || hasOwnKey(set, Keys.wsMeta(id))),
      );
      const stagedIndex = set[Keys.wsIndex] as string[];
      set[Keys.wsIndex] = [...new Set([...stagedIndex, ...extra])];
    }
    // Progress is recorded after each step so a later failure reports what was applied.
    await repo.setMany(set);
    const progress = [...done, ...Object.keys(set).filter((k) => !done.has(k))];
    await repo.setMany({ [Keys.importStaging]: { ...staged, progress } });
    if (remove.length > 0) {
      await repo.remove(remove);
      await repo.setMany({
        [Keys.importStaging]: { ...staged, progress: [...progress, ...remove] },
      });
    }
    await this.reconcileWindows();
    // An earlier failed attempt of this same import may have set it aside: it is resolved now.
    const failed = await repo.store.get<unknown>(BgKeys.importFailed);
    const sameImport =
      isRecord(failed) && isRecord(failed.staging) && failed.staging.startedAt === staged.startedAt;
    await repo.remove(sameImport ? [Keys.importStaging, BgKeys.importFailed] : Keys.importStaging);
    return true;
  }

  private async reconcileWindows(): Promise<void> {
    const { repo } = this.ctx;
    const index = new Set(await repo.getWorkspaceIndex());
    const writes: Record<string, unknown> = {};
    const affected: number[] = [];
    for (const [windowId, st] of await repo.listWindowStates()) {
      if (st.activeWorkspaceId === null) continue;
      const exists =
        index.has(st.activeWorkspaceId) && (await repo.getWorkspaceMeta(st.activeWorkspaceId));
      if (exists) continue;
      writes[Keys.window(windowId)] = { activeWorkspaceId: null, sessionEpoch: st.sessionEpoch };
      affected.push(windowId);
    }
    if (affected.length > 0) await repo.setMany(writes);
    for (const w of affected) this.deps.markDirty?.(w);
  }
}
