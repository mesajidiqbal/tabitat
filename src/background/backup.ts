/**
 * Export / import (ARCHITECTURE §6): the import is validated, its full write set is staged under
 * `import:staging`, then applied (one set + one remove) and the staging key deleted. An
 * interrupted import is re-applied by init (`applyStaged`). Afterwards windows:* records that
 * point to workspaces that no longer exist are reset to null (their tabs fall back to Unsorted;
 * live tabs are never touched).
 */
import * as v from "valibot";
import { buildBackup, planImport, validateBackup } from "../core/backup";
import type { BackupFile } from "../core/model/types";
import { Keys } from "../core/model/types";
import type { ImportReport } from "../messaging/commands";
import { RpcError } from "../messaging/errors";
import type { BgContext } from "./context";

const StagingSchema = v.object({
  set: v.record(v.string(), v.unknown()),
  remove: v.array(v.string()),
  startedAt: v.number(),
});

export interface BackupDeps {
  markDirty?(windowId: number): void;
  hasRunningOps?(): boolean;
}

export class BackupService {
  constructor(
    private readonly ctx: BgContext,
    private readonly deps: BackupDeps = {},
  ) {}

  async exportBackup(): Promise<BackupFile> {
    return buildBackup(await this.ctx.repo.getAll(), this.ctx.ports.now());
  }

  async importBackup(file: unknown, mode: "replace" | "merge"): Promise<ImportReport> {
    const { repo, ports } = this.ctx;
    const parsed = validateBackup(file);
    if (this.deps.hasRunningOps?.() || (await repo.listOps()).length > 0) {
      throw new RpcError("busy", "a workspace switch is pending; try again when it finishes");
    }
    const existing = await repo.getAll();
    const plan = planImport(parsed, existing, mode, { newId: ports.newId, now: ports.now() });
    await repo.setMany({
      [Keys.importStaging]: { set: plan.set, remove: plan.remove, startedAt: ports.now() },
    });
    await this.applyStaged();
    return plan.report;
  }

  /** Applies a staged import if one exists (also called by init after a crash). */
  async applyStaged(): Promise<boolean> {
    const { repo } = this.ctx;
    const raw = await repo.store.get(Keys.importStaging);
    if (raw === undefined) return false;
    const res = v.safeParse(StagingSchema, raw);
    if (!res.success) {
      await repo.quarantine(Keys.importStaging, raw, new Error("invalid import staging record"));
      return false;
    }
    await repo.setMany(res.output.set);
    const remove = res.output.remove.filter((k) => !(k in res.output.set));
    if (remove.length > 0) await repo.remove(remove);
    await this.reconcileWindows();
    await repo.remove(Keys.importStaging);
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
