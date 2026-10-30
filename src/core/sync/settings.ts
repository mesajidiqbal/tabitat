/**
 * Settings sync rules (docs/PHASE3.md §4). Pure: the worker's settings-sync service does the I/O.
 * Last-write-wins on `Settings.updatedAt`; `rev` is local-only; an image wallpaper is
 * device-specific and never leaves the device.
 */
import type { Settings } from "../model/types";

/** The only item ever written to storage.sync (ARCHITECTURE §10). */
export const SYNC_SETTINGS_KEY = "settings";

/** Short codes stored in `sync:status.error` (the UI translates them). */
export type SyncErrorCode = "too_large" | "quota" | "unavailable" | "invalid_remote";

type SyncPayload = Omit<Settings, "rev" | "dashboard"> & {
  dashboard: Omit<Settings["dashboard"], "wallpaper"> & {
    wallpaper?: Settings["dashboard"]["wallpaper"];
  };
};

/** What is pushed: the settings without `rev`, and without the wallpaper when it is an image. */
export function toSyncPayload(settings: Settings): SyncPayload {
  const { rev: _rev, ...rest } = structuredClone(settings);
  const out: SyncPayload = rest;
  if (settings.dashboard.wallpaper.kind === "image") {
    const { wallpaper: _drop, ...dashboard } = out.dashboard;
    out.dashboard = dashboard;
  }
  return out;
}

/** Bytes storage.sync charges for one item: key + JSON value, UTF-8. */
export function syncItemBytes(key: string, value: unknown): number {
  return new TextEncoder().encode(key + JSON.stringify(value)).length;
}

/** True when the remote copy wins (missing `updatedAt` counts as 0; ties keep local). */
export function isRemoteNewer(remoteUpdatedAt?: number, localUpdatedAt?: number): boolean {
  return (remoteUpdatedAt ?? 0) > (localUpdatedAt ?? 0);
}

function rawHasWallpaper(raw: unknown): boolean {
  if (typeof raw !== "object" || raw === null) return false;
  const dash = (raw as { dashboard?: unknown }).dashboard;
  if (typeof dash !== "object" || dash === null) return false;
  return (dash as { wallpaper?: unknown }).wallpaper !== undefined;
}

/**
 * The local settings after applying a validated remote copy (`remote` = parseSettings(raw)):
 * remote values, `rev: local.rev + 1`, the REMOTE `updatedAt` (so it does not bounce back), and
 * this device's `syncSettings` flag. The local wallpaper is kept when the remote has none (an
 * image wallpaper is never pushed), or when either side's wallpaper is an image (device-specific).
 */
export function applyRemoteSettings(local: Settings, remote: Settings, raw: unknown): Settings {
  const next: Settings = {
    ...structuredClone(remote),
    syncSettings: local.syncSettings,
    rev: local.rev + 1,
  };
  if (remote.updatedAt === undefined) delete next.updatedAt;
  const keepLocalWallpaper =
    !rawHasWallpaper(raw) ||
    local.dashboard.wallpaper.kind === "image" ||
    remote.dashboard.wallpaper.kind === "image";
  if (keepLocalWallpaper) {
    next.dashboard = { ...next.dashboard, wallpaper: { ...local.dashboard.wallpaper } };
  }
  return next;
}

/**
 * Maps a storage.sync write failure to a status code: the per-item limit is "too_large", the
 * other quotas (total bytes, item count, write rate) "quota", anything else "unavailable".
 */
export function classifySyncError(e: unknown): Exclude<SyncErrorCode, "invalid_remote"> {
  const msg = e instanceof Error ? e.message : String(e);
  if (/QUOTA_BYTES_PER_ITEM/i.test(msg)) return "too_large";
  return /QUOTA_BYTES|MAX_ITEMS|MAX_WRITE_OPERATIONS/i.test(msg) ? "quota" : "unavailable";
}
