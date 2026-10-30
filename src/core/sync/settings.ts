/**
 * Settings sync rules (docs/PHASE3.md §4). Pure: the worker's settings-sync service does the I/O.
 * Last-write-wins on `Settings.updatedAt`; `rev` is local-only; `theme` and an image wallpaper
 * are device-specific and never leave the device.
 */
import type { Settings } from "../model/types";

/** The only item ever written to storage.sync (ARCHITECTURE §10). */
export const SYNC_SETTINGS_KEY = "settings";

/** Short codes stored in `sync:status.error` (the UI translates them). */
export type SyncErrorCode = "too_large" | "quota" | "unavailable" | "invalid_remote";

export type SyncPayload = Omit<Settings, "rev" | "theme" | "dashboard"> & {
  dashboard: Omit<Settings["dashboard"], "wallpaper"> & {
    wallpaper?: Settings["dashboard"]["wallpaper"];
  };
};

/**
 * `updatedAt` for a LOCAL write: never at or below the stored stamp, so a local edit made after
 * pulling a copy stamped by a device with a later clock still wins LWW, and two consecutive
 * writes never share a stamp. (A pull keeps the remote stamp instead.)
 */
export function nextLocalUpdatedAt(now: number, prevUpdatedAt: number | undefined): number {
  return Math.max(now, (prevUpdatedAt ?? 0) + 1);
}

/**
 * What is pushed: the settings without `rev` and `theme` (device-specific), and without the
 * wallpaper when it is an image.
 */
export function toSyncPayload(settings: Settings): SyncPayload {
  const { rev: _rev, theme: _theme, ...rest } = structuredClone(settings);
  const out: SyncPayload = rest;
  if (settings.dashboard.wallpaper.kind === "image") {
    const { wallpaper: _drop, ...dashboard } = out.dashboard;
    out.dashboard = dashboard;
  }
  return out;
}

function canonical(x: unknown): unknown {
  if (Array.isArray(x)) return x.map(canonical);
  if (typeof x !== "object" || x === null) return x;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(x).sort()) out[k] = canonical((x as Record<string, unknown>)[k]);
  return out;
}

/**
 * True when pushing `local` would write exactly `remoteRaw` (JSON-equal, key order ignored):
 * after a pull applied the remote copy, a push would only echo it back.
 */
export function payloadEquals(local: Settings, remoteRaw: unknown): boolean {
  const mine = JSON.parse(JSON.stringify(toSyncPayload(local))) as unknown;
  return JSON.stringify(canonical(mine)) === JSON.stringify(canonical(remoteRaw));
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
 * this device's `syncSettings` flag and `theme` (device-specific; ignored even when an older
 * build pushed one). The local wallpaper is kept when the remote has none (an image wallpaper is
 * never pushed), or when either side's wallpaper is an image (device-specific).
 */
export function applyRemoteSettings(local: Settings, remote: Settings, raw: unknown): Settings {
  const next: Settings = {
    ...structuredClone(remote),
    syncSettings: local.syncSettings,
    theme: local.theme,
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
