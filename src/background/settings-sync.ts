/**
 * Opt-in settings sync over storage.sync (docs/PHASE3.md §4, ARCHITECTURE §10). Only the
 * `settings` item is written. Last-write-wins on `updatedAt`:
 *  - push: after every `settings.update` while `syncSettings` is on, and in `settings.syncNow`
 *    (skipped when the pull just before it made the local copy identical to the remote one);
 *  - pull: at init (after migrations), on a storage.sync change of `settings`, when sync is
 *    turned on (before the first push) and in `settings.syncNow`. A pull writes the remote
 *    values with the REMOTE `updatedAt`, so it never bounces back, and it never pushes.
 * Failures never touch the local settings; they are recorded in `sync:status` (no retry loop).
 * Every method expects the caller to hold lane `key:settings` (or to run inside init).
 */
import * as v from "valibot";
import { fitSettingsWhitelist, parseSettings } from "../core/model/schemas";
import type { Settings } from "../core/model/types";
import { Keys } from "../core/model/types";
import {
  applyRemoteSettings,
  classifySyncError,
  isRemoteNewer,
  payloadEquals,
  SYNC_SETTINGS_KEY,
  type SyncErrorCode,
  syncItemBytes,
  toSyncPayload,
} from "../core/sync/settings";
import type { SyncStatus } from "../messaging/commands";
import { RpcError } from "../messaging/errors";
import type { Unsubscribe } from "../platform/events";
import type { BgContext } from "./context";
import { BgKeys, SyncStatusSchema } from "./keys";
import { ALARMS, repairAlarms } from "./ready";

/** Errors a successful pull does not resolve (they are about pushing). */
const PUSH_ERRORS: readonly string[] = ["too_large", "quota"];

function enabledBase(st: SyncStatus): SyncStatus {
  const out: SyncStatus = { enabled: true };
  if (st.lastPushAt !== undefined) out.lastPushAt = st.lastPushAt;
  if (st.lastPullAt !== undefined) out.lastPullAt = st.lastPullAt;
  return out;
}

export class SettingsSync {
  constructor(private readonly ctx: BgContext) {}

  /** Current `sync:status` (`{ enabled: false }` when absent or unreadable). */
  async status(): Promise<SyncStatus> {
    const raw = await this.ctx.ports.local.get(BgKeys.syncStatus);
    const res = v.safeParse(SyncStatusSchema, raw);
    return res.success ? res.output : { enabled: false };
  }

  private async writeStatus(st: SyncStatus): Promise<SyncStatus> {
    await this.ctx.repo.setMany({ [BgKeys.syncStatus]: st });
    return st;
  }

  private fail(st: SyncStatus, error: SyncErrorCode): Promise<SyncStatus> {
    return this.writeStatus({ ...enabledBase(st), error });
  }

  /**
   * Subscribes to storage.sync changes of `settings`. `run` wraps each pull (readiness + lane
   * `key:settings`); our own pushes come back here too and are ignored (not newer).
   */
  start(run: (pull: () => Promise<unknown>) => Promise<unknown>): Unsubscribe {
    return this.ctx.ports.sync.onChanged((changes) => {
      if (!Object.hasOwn(changes, SYNC_SETTINGS_KEY)) return;
      void run(() => this.pull()).catch((e) => this.ctx.log.warn("[tabitat] settings pull", e));
    });
  }

  /**
   * Applies the remote copy when it is newer than the local one (or than `newerThan`). Returns
   * the settings now stored when it applied them, else null. No-op while sync is off.
   */
  async pull(opts: { newerThan?: number } = {}): Promise<Settings | null> {
    return (await this.pullApplied(opts))?.settings ?? null;
  }

  /** `pull`, also returning the raw remote copy it applied. */
  private async pullApplied(
    opts: { newerThan?: number } = {},
  ): Promise<{ settings: Settings; raw: unknown } | null> {
    const { ports, repo, log } = this.ctx;
    const local = await repo.getSettings();
    if (!local.syncSettings) return null;
    const st = await this.status();
    if (!ports.sync.available) {
      await this.fail(st, "unavailable");
      return null;
    }
    let raw: unknown;
    try {
      raw = await ports.sync.get(SYNC_SETTINGS_KEY);
    } catch (e) {
      log.warn("[tabitat] storage.sync read failed", e);
      await this.fail(st, "unavailable");
      return null;
    }
    if (raw === undefined) return null;
    let remote: Settings;
    try {
      // An older build may have pushed a whitelist over today's limits: cut, do not reject.
      remote = parseSettings(fitSettingsWhitelist(raw)?.raw ?? raw);
    } catch (e) {
      log.warn("[tabitat] remote settings are invalid; keeping local", e);
      await this.fail(st, "invalid_remote");
      return null;
    }
    const keepError = st.error !== undefined && PUSH_ERRORS.includes(st.error);
    if (!isRemoteNewer(remote.updatedAt, opts.newerThan ?? local.updatedAt)) {
      if (st.error !== undefined && !keepError) await this.writeStatus(enabledBase(st));
      return null;
    }
    const next = applyRemoteSettings(local, remote, raw);
    const status: SyncStatus = { ...enabledBase(st), lastPullAt: ports.now() };
    if (keepError) status.error = st.error as string;
    await repo.setMany({ [Keys.settings]: next, [BgKeys.syncStatus]: status });
    await this.repairAlarmsAfter(local, next);
    return { settings: next, raw };
  }

  /** Writes `settings` (minus rev / image wallpaper) to storage.sync; records the outcome. */
  async push(settings: Settings): Promise<SyncStatus> {
    const { ports, log } = this.ctx;
    const st = await this.status();
    if (!ports.sync.available) return this.fail(st, "unavailable");
    const payload = toSyncPayload(settings);
    if (syncItemBytes(SYNC_SETTINGS_KEY, payload) > ports.sync.QUOTA_BYTES_PER_ITEM) {
      return this.fail(st, "too_large");
    }
    try {
      await ports.sync.set({ [SYNC_SETTINGS_KEY]: payload });
    } catch (e) {
      log.warn("[tabitat] storage.sync write failed", e);
      return this.fail(st, classifySyncError(e));
    }
    return this.writeStatus({ ...enabledBase(st), lastPushAt: ports.now() });
  }

  /**
   * Called by `settings.update` after `next` was stored. Sync on: push (turning it on pulls
   * first, comparing the remote with the settings as they were before this update). Turned
   * off: `sync:status = { enabled: false }`; the remote copy stays. Returns the stored settings.
   */
  async afterUpdate(prev: Settings, next: Settings): Promise<Settings> {
    if (!next.syncSettings) {
      if (prev.syncSettings || (await this.status()).enabled) {
        await this.writeStatus({ enabled: false });
      }
      return next;
    }
    if (prev.syncSettings) {
      await this.push(next);
      return next;
    }
    const pulled = await this.pullApplied({ newerThan: prev.updatedAt ?? 0 });
    // Nothing to push when the pull made us identical to the remote copy.
    if (!pulled || !payloadEquals(pulled.settings, pulled.raw)) {
      await this.push(pulled?.settings ?? next);
    }
    return pulled?.settings ?? next;
  }

  /**
   * `settings.syncNow`: one pull, then one push (skipped when the pull just made the local
   * settings identical to the remote copy). `invalid` while sync is off.
   */
  async syncNow(): Promise<SyncStatus> {
    const local = await this.ctx.repo.getSettings();
    if (!local.syncSettings) throw new RpcError("invalid", "settings sync is off");
    const pulled = await this.pullApplied();
    if (pulled && payloadEquals(pulled.settings, pulled.raw)) return this.status();
    return this.push(pulled?.settings ?? (await this.ctx.repo.getSettings()));
  }

  private async repairAlarmsAfter(prev: Settings, next: Settings): Promise<void> {
    const period = prev.sessions.everyMinutes !== next.sessions.everyMinutes;
    if (!period && prev.suspend.enabled === next.suspend.enabled) return;
    await repairAlarms(this.ctx, next, period ? [ALARMS.sessionGen] : []).catch((e) =>
      this.ctx.log.warn("[tabitat] alarm repair after pull", e),
    );
  }
}
