/**
 * Init barrier (ARCHITECTURE §5.2). `init` runs once per worker life; every event and message
 * handler awaits `ready()` first. Steps, in order:
 *  1. session epoch (storage.session; missing => browser (re)start)
 *  2. migrations (resumable: `migration:<n>` progress key, diffs written with diffSnapshots)
 *  3. re-apply an interrupted import (`import:staging`)
 *  4. op journal replay: canResume => resume, else abandon to `recovery:pending` (nothing deleted)
 *  5. window reconciliation (windows:* records, sessionEpoch)
 *  6. alarm repair
 *  7. flush windows left dirty by a killed worker
 *  8. a session generation (never from an all-empty state)
 */
import {
  applyMigrations,
  diffSnapshots,
  planMigrations,
  storedSchemaVersion,
} from "../core/model/migrations";
import type { Flavor, Settings } from "../core/model/types";
import { KEY_PREFIX, Keys } from "../core/model/types";
import type { WindowMatch } from "../core/reconcile/matcher";
import type { BackupService } from "./backup";
import type { BgContext } from "./context";
import { reconcileWindows } from "./reconciler";
import type { SessionGuard } from "./session-guard";
import type { TabTracker } from "./tab-tracker";
import type { WorkspaceEngine } from "./workspace-engine";

export class ReadyBarrier {
  private readonly promise: Promise<void>;
  private resolve: () => void = () => {};
  private reject: (e: unknown) => void = () => {};
  private started = false;

  constructor() {
    this.promise = new Promise<void>((res, rej) => {
      this.resolve = res;
      this.reject = rej;
    });
    this.promise.catch(() => {});
  }

  ready(): Promise<void> {
    return this.promise;
  }

  get isStarted(): boolean {
    return this.started;
  }

  /** Runs `fn` once; later calls return the same barrier. */
  run(fn: () => Promise<unknown>): Promise<void> {
    if (!this.started) {
      this.started = true;
      fn().then(
        () => this.resolve(),
        (e) => this.reject(e),
      );
    }
    return this.promise;
  }
}

// Default barrier for code that is not handed a Services object.
const defaultBarrier = new ReadyBarrier();
export function ready(): Promise<void> {
  return defaultBarrier.ready();
}
export function markReady(): void {
  defaultBarrier.run(async () => {});
}

export const ALARMS = {
  flushDirty: "flush-dirty",
  sessionGen: "session-gen",
  suspendScan: "suspend-scan",
  trashPurge: "trash-purge",
} as const;

/** Creates missing alarms (and clears suspend-scan when disabled). `recreate` forces re-creation. */
export async function repairAlarms(
  ctx: BgContext,
  settings: Settings,
  recreate: readonly string[] = [],
): Promise<string[]> {
  const expected = new Map<string, number>([
    [ALARMS.flushDirty, 1],
    [ALARMS.sessionGen, Math.max(1, settings.sessions.everyMinutes)],
    [ALARMS.trashPurge, 60],
  ]);
  if (settings.suspend.enabled) expected.set(ALARMS.suspendScan, 1);
  const have = new Set(await ctx.ports.alarms.getAll());
  const created: string[] = [];
  for (const [name, period] of expected) {
    if (have.has(name) && !recreate.includes(name)) continue;
    // Never below 30 s (spike S5: only packaged installs clamp).
    await ctx.ports.alarms.create(name, { periodInMinutes: period, delayInMinutes: period });
    created.push(name);
  }
  if (!settings.suspend.enabled && have.has(ALARMS.suspendScan)) {
    await ctx.ports.alarms.clear(ALARMS.suspendScan);
  }
  return created;
}

export interface InitDeps {
  ctx: BgContext;
  engine: WorkspaceEngine;
  tracker: TabTracker;
  sessionGuard: SessionGuard;
  backup: BackupService;
  flavor: Flavor;
}

export interface InitReport {
  epoch: string;
  browserStarted: boolean;
  migrated: number[];
  importReapplied: boolean;
  ops: Array<{ windowId: number; result: "resumed" | "abandoned" | "failed" }>;
  matches: WindowMatch[];
  alarmsCreated: string[];
  flushed: number[];
  generation: number | null;
  errors: string[];
}

export async function runInit(d: InitDeps): Promise<InitReport> {
  const { ctx, engine, tracker } = d;
  const { ports, repo } = ctx;
  const report: InitReport = {
    epoch: "",
    browserStarted: false,
    migrated: [],
    importReapplied: false,
    ops: [],
    matches: [],
    alarmsCreated: [],
    flushed: [],
    generation: null,
    errors: [],
  };
  const step = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      ctx.log.error(`[tabitat] init step "${name}" failed`, e);
      report.errors.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  // 1. epoch (fatal: ops/reconcile depend on it)
  let epoch = await ports.session.get<string>(Keys.epoch);
  if (typeof epoch !== "string" || epoch === "") {
    epoch = ports.newId();
    await ports.session.set({ [Keys.epoch]: epoch });
    report.browserStarted = true;
  }
  ctx.epoch = epoch;
  report.epoch = epoch;

  // 2. migrations (fatal: never run on data of an unknown layout)
  let snapshot = await repo.getAll();
  const from = storedSchemaVersion(snapshot);
  for (const m of planMigrations(from)) {
    await repo.setMany({ [Keys.migration(m.version)]: { startedAt: ports.now(), from } });
    const next = applyMigrations(snapshot, m.version - 1, m.version, {
      now: ports.now(),
      flavor: d.flavor,
    });
    const diff = diffSnapshots(snapshot, next);
    if (Object.keys(diff.set).length > 0) await repo.setMany(diff.set);
    if (diff.remove.length > 0) await repo.remove(diff.remove);
    await repo.remove(Keys.migration(m.version));
    snapshot = next;
    report.migrated.push(m.version);
  }

  // 3. interrupted import
  await step("import", async () => {
    report.importReapplied = await d.backup.applyStaged();
  });

  // 4. op journal
  await step("ops", async () => {
    for (const op of await repo.listOps()) {
      report.ops.push({ windowId: op.windowId, result: await engine.resumeOrAbandon(op) });
    }
  });

  // 5. windows
  let windows: Awaited<ReturnType<BgContext["getAllWindows"]>> = [];
  await step("reconcile", async () => {
    windows = await ctx.getAllWindows();
    tracker.seed(windows);
    report.matches = (await reconcileWindows(ctx, windows)).matches;
  });

  // 6. alarms
  await step("alarms", async () => {
    report.alarmsCreated = await repairAlarms(ctx, await repo.getSettings());
  });

  // 7. dirty windows left by a killed worker
  await step("dirty", async () => {
    const live = new Set(windows.map((w) => w.id));
    const ids = Object.keys(snapshot)
      .filter((k) => k.startsWith(KEY_PREFIX.dirty))
      .map((k) => Number(k.slice(KEY_PREFIX.dirty.length)))
      .filter((id) => live.has(id));
    for (const id of ids) {
      await tracker.flush(id);
      report.flushed.push(id);
    }
  });

  // 8. session generation
  await step("generation", async () => {
    report.generation = await d.sessionGuard.take();
  });

  return report;
}
