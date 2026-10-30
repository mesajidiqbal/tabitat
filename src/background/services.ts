/**
 * Composition root for the service worker. `createServices(ports)` builds every service;
 * `start()` registers all event listeners synchronously (MV3 top-level rule) and `init()` runs
 * the init barrier once. Tests build it over FakeBrowser ports and re-create it after
 * `fake.killWorker()` to simulate a worker restart.
 */
import type { Flavor } from "../core/model/types";
import type { BgPorts, Unsubscribe } from "../platform/events";
import { BackupService } from "./backup";
import { Badge } from "./badge";
import { CommandRouter } from "./command-router";
import { Shortcuts } from "./commands";
import { BgContext } from "./context";
import { purgeExpiredTrash, registerHandlers } from "./handlers";
import { Lane, LaneQueue } from "./lanes";
import { POMODORO_ALARM, PomodoroService } from "./pomodoro";
import { ALARMS, type InitReport, ReadyBarrier, runInit } from "./ready";
import { type Logger, Repository } from "./repository";
import { SessionGuard } from "./session-guard";
import { Suspender } from "./suspender";
import { TabTracker } from "./tab-tracker";
import { type EngineHooks, switchLanes, WorkspaceEngine } from "./workspace-engine";

export interface ServiceOptions {
  flavor?: Flavor;
  /** Internal schemes the running browser can open (platform/brand.ts). */
  directSchemes?: string[];
  debounceMs?: number;
  retryDelayMs?: number | null;
  hooks?: EngineHooks;
  log?: Logger;
}

export interface Services {
  ports: BgPorts;
  ctx: BgContext;
  repo: Repository;
  lanes: LaneQueue;
  router: CommandRouter;
  engine: WorkspaceEngine;
  tracker: TabTracker;
  sessionGuard: SessionGuard;
  backup: BackupService;
  suspender: Suspender;
  pomodoro: PomodoroService;
  badge: Badge;
  shortcuts: Shortcuts;
  barrier: ReadyBarrier;
  /** Last init report (diagnostics/tests). */
  initReport: InitReport | null;
  ready(): Promise<void>;
  /** Registers listeners (synchronously). */
  start(): void;
  /** Runs the init barrier once. */
  init(): Promise<void>;
  onAlarm(name: string): Promise<void>;
  stop(): void;
}

export function createServices(ports: BgPorts, opts: ServiceOptions = {}): Services {
  const log = opts.log ?? console;
  const repo = new Repository(ports.local, ports.now, log);
  const lanes = new LaneQueue();
  const ctx = new BgContext(ports, repo, lanes, opts.directSchemes ?? ["chrome:", "about:"], log);
  const barrier = new ReadyBarrier();
  const ready = () => barrier.ready();
  const badge = new Badge(ctx);

  // Late-bound references (services depend on each other through narrow callbacks).
  let tracker: TabTracker | null = null;
  let sessionGuard: SessionGuard | null = null;

  const engineDeps: ConstructorParameters<typeof WorkspaceEngine>[1] = {
    takeGeneration: () => sessionGuard?.take() ?? Promise.resolve(null),
    refreshBadge: (w) => badge.refreshWindow(w),
    markDirty: (w) => tracker?.markDirty(w),
  };
  if (opts.hooks) engineDeps.hooks = opts.hooks;
  if (opts.retryDelayMs !== undefined) engineDeps.retryDelayMs = opts.retryDelayMs;
  const engine = new WorkspaceEngine(ctx, engineDeps);

  const trackerDeps: ConstructorParameters<typeof TabTracker>[1] = {
    ready,
    isLocked: (w) => engine.isLocked(w),
    wasClosedBySwitch: (id) => engine.wasClosedBySwitch(id),
    onTabReplaced: (a, r) => engine.onTabReplaced(a, r),
    onOrphanedOp: async (w) => {
      const op = await repo.getOp(w);
      if (op && !engine.isBusy(w)) await engine.abandon(op, "window closed during the switch");
    },
    onWindowGone: async () => {
      await sessionGuard?.take().catch((e) => log.warn("[tabitat] generation failed", e));
    },
    onActivated: (tabId, windowId) => badge.refreshTab(tabId, windowId).catch(() => {}),
  };
  if (opts.debounceMs !== undefined) trackerDeps.debounceMs = opts.debounceMs;
  tracker = new TabTracker(ctx, trackerDeps);
  const trackerRef = tracker;

  sessionGuard = new SessionGuard(ctx, {
    lockWindow: (w) => engine.lockWindow(w),
    unlockWindow: (w) => engine.unlockWindow(w),
  });
  const guardRef = sessionGuard;

  const backup = new BackupService(ctx, {
    markDirty: (w) => trackerRef.markDirty(w),
  });
  const suspender = new Suspender(ctx, { isLocked: (w) => engine.isLocked(w) });
  const pomodoro = new PomodoroService(ctx);
  const router = new CommandRouter({ lanes, now: ports.now, ready, log });
  const shortcuts = new Shortcuts({
    shell: ports.shell,
    dispatch: (m) => router.dispatch(m),
    ready,
    newId: ports.newId,
    log,
  });
  const subs: Unsubscribe[] = [];

  const services: Services = {
    ports,
    ctx,
    repo,
    lanes,
    router,
    engine,
    tracker: trackerRef,
    sessionGuard: guardRef,
    backup,
    suspender,
    pomodoro,
    badge,
    shortcuts,
    barrier,
    initReport: null,
    ready,
    start() {
      trackerRef.start();
      subs.push(
        ports.events.onAlarm((name) => {
          void services.onAlarm(name).catch((e) => log.error("[tabitat] alarm failed", name, e));
        }),
        ports.events.onCommand((command, tab) => {
          // Synchronous: side panel / popup must open inside the gesture.
          void shortcuts.handle(command, tab).catch((e) => log.error("[tabitat] command", e));
        }),
      );
    },
    init() {
      return barrier.run(async () => {
        services.initReport = await runInit({
          ctx,
          engine,
          tracker: trackerRef,
          sessionGuard: guardRef,
          backup,
          flavor: opts.flavor ?? "default",
        });
      });
    },
    async onAlarm(name) {
      await ready();
      switch (name) {
        case ALARMS.flushDirty:
          await trackerRef.flushAll();
          await engine.resumePending();
          return;
        case ALARMS.sessionGen:
          await lanes.run([Lane.sessions], () => guardRef.take());
          return;
        case ALARMS.suspendScan:
          await lanes.run(["suspender"], () => suspender.scan());
          return;
        case ALARMS.trashPurge:
          await lanes.run([Lane.trash], () => purgeExpiredTrash(services));
          return;
        case POMODORO_ALARM:
          await lanes.run([Lane.key("pomodoro")], () => pomodoro.onAlarm());
          return;
      }
    },
    stop() {
      trackerRef.stop();
      for (const off of subs.splice(0)) off();
    },
  };
  registerHandlers(router, services);
  return services;
}

export { switchLanes };
