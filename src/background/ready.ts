/**
 * Init barrier (ARCHITECTURE §5.2). `init` runs once per worker life; every event and message
 * handler awaits `ready()` first. A failed init is not cached forever: `ready()` then resolves
 * as degraded (read-only commands still answer, mutating ones get a retryable `internal`) and the
 * next startup event / alarm / message re-attempts init. Steps, in order:
 *  1. session epoch (storage.session; missing => worker context reset: browser restart, or
 *     extension reload/update/disable — window ids are verified, never trusted on the epoch)
 *  2. migrations (resumable: `migration:<n>` progress key, diffs written with diffSnapshots)
 *  3. resolve an interrupted import (`import:staging`) before anything else may write: replay
 *     it (revision-aware); after two failed replays it moves to `import:failed`
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

/** Outcome of the latest init attempt. */
export type ReadyState = { degraded: false } | { degraded: true; error: string; cause: unknown };

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export class ReadyBarrier {
  private readonly first: Promise<ReadyState>;
  private resolveFirst: (s: ReadyState) => void = () => {};
  private current: Promise<ReadyState>;
  private started = false;
  private running = false;
  private last: ReadyState | null = null;

  constructor() {
    this.first = new Promise<ReadyState>((res) => {
      this.resolveFirst = res;
    });
    this.current = this.first;
  }

  /** Resolves (never rejects) when the current init attempt has finished. */
  ready(): Promise<ReadyState> {
    return this.current;
  }

  get isStarted(): boolean {
    return this.started;
  }

  get isRunning(): boolean {
    return this.running;
  }

  get isDegraded(): boolean {
    return this.last?.degraded === true;
  }

  get state(): ReadyState | null {
    return this.last;
  }

  /**
   * Runs `fn` unless it already succeeded or is running; a failed attempt is retried by the next
   * call. Resolves when the attempt succeeded, rejects with its error otherwise.
   */
  run(fn: () => Promise<unknown>): Promise<void> {
    if (!this.running && (!this.started || this.isDegraded)) {
      const retry = this.started;
      this.started = true;
      this.running = true;
      const done = fn().then(
        (): ReadyState => ({ degraded: false }),
        (e: unknown): ReadyState => ({ degraded: true, error: message(e), cause: e }),
      );
      const settled = done.then((st) => {
        this.running = false;
        this.last = st;
        this.resolveFirst(st);
        return st;
      });
      if (retry) this.current = settled;
    }
    return this.current.then((st) => {
      if (st.degraded) throw st.cause;
    });
  }
}

// Default barrier for code that is not handed a Services object.
const defaultBarrier = new ReadyBarrier();
export function ready(): Promise<ReadyState> {
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
  /**
   * The storage.session epoch was missing: the worker context was reset (browser restart, or
   * extension reload/update/disable). Says nothing by itself about window ids.
   */
  contextReset: boolean;
  migrated: number[];
  importReapplied: boolean;
  /** The staged import failed twice and was moved to `import:failed`. */
  importFailed: boolean;
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
    contextReset: false,
    migrated: [],
    importReapplied: false,
    importFailed: false,
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
    report.contextReset = true;
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

  // 3. interrupted import (fatal if it can be neither applied nor set aside: no command may
  //    write while a staged import is unresolved)
  const resolved = await d.backup.resolveStaged();
  report.importReapplied = resolved === "applied";
  report.importFailed = resolved === "failed";

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
    // Windows that closed while no worker was alive: save their last-known contents first
    // (reconciliation below drops their windows:* records).
    const live = new Set(windows.map((w) => w.id));
    for (const id of await tracker.closedWhileAway(live)) await tracker.handleWindowRemoved(id);
    await tracker.adoptSessionCache(windows);
    tracker.seed(windows);
    report.matches = (
      await reconcileWindows(ctx, windows, {
        takeStorageGeneration: () => d.sessionGuard.takeFromStorage(),
      })
    ).matches;
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
