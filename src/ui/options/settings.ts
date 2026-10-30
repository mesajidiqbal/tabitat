/**
 * Options-page settings helpers (pure): defensive parse of the stored `settings` record, input
 * ranges, and the reset patch. The page reads storage directly, so it cannot trust the shape.
 */
import { DEFAULT_SETTINGS, type Settings } from "@/core/model/types";

const isObj = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);

const posInt = (x: unknown, d: number): number =>
  typeof x === "number" && Number.isInteger(x) && x >= 1 ? x : d;

const bool = (x: unknown, d: boolean): boolean => (typeof x === "boolean" ? x : d);

/** Parses a stored settings record; every invalid or missing field falls back to its default. */
export function parseSettingsLoose(raw: unknown): Settings {
  const d = DEFAULT_SETTINGS;
  if (!isObj(raw)) return structuredClone(d);
  const sus = isObj(raw.suspend) ? raw.suspend : {};
  const ses = isObj(raw.sessions) ? raw.sessions : {};
  const pom = isObj(raw.pomodoro) ? raw.pomodoro : {};
  const theme = raw.theme === "light" || raw.theme === "dark" ? raw.theme : "system";
  const out: Settings = {
    theme,
    dashboard: isObj(raw.dashboard)
      ? (raw.dashboard as unknown as Settings["dashboard"])
      : structuredClone(d.dashboard),
    suspend: {
      enabled: bool(sus.enabled, d.suspend.enabled),
      afterMinutes: posInt(sus.afterMinutes, d.suspend.afterMinutes),
      whitelist: Array.isArray(sus.whitelist)
        ? sus.whitelist.filter((h): h is string => typeof h === "string")
        : [],
    },
    sessions: {
      everyMinutes: posInt(ses.everyMinutes, d.sessions.everyMinutes),
      keep: posInt(ses.keep, d.sessions.keep),
    },
    pomodoro: {
      workMin: posInt(pom.workMin, d.pomodoro.workMin),
      breakMin: posInt(pom.breakMin, d.pomodoro.breakMin),
      longBreakMin: posInt(pom.longBreakMin, d.pomodoro.longBreakMin),
      roundsBeforeLong: posInt(pom.roundsBeforeLong, d.pomodoro.roundsBeforeLong),
    },
    syncSettings: bool(raw.syncSettings, d.syncSettings),
    restoreLimit: posInt(raw.restoreLimit, d.restoreLimit),
    rev: typeof raw.rev === "number" && Number.isInteger(raw.rev) && raw.rev >= 0 ? raw.rev : d.rev,
  };
  if (typeof raw.updatedAt === "number") out.updatedAt = raw.updatedAt;
  return out;
}

/** Allowed ranges of the numeric controls (docs/PHASE3.md §5). */
export const RANGES = {
  restoreLimit: { min: 10, max: 500, step: 10 },
  suspendMinutes: { min: 5, max: 720, step: 1 },
  snapshotEvery: { min: 1, max: 60, step: 1 },
  snapshotKeep: { min: 3, max: 30, step: 1 },
  workMin: { min: 1, max: 180, step: 1 },
  breakMin: { min: 1, max: 60, step: 1 },
  longBreakMin: { min: 1, max: 120, step: 1 },
  rounds: { min: 1, max: 12, step: 1 },
} as const;

/**
 * Whether a queued settings patch may still be sent. `baseRev`: the rev the patch was made
 * against (known when it was queued); `ackedRev`: the rev of our own last acknowledged write;
 * `currentRev`: the latest rev seen. A rev past both came from somewhere else (another surface
 * or a sync pull) after the patch was made: the patch is stale and must not overwrite it.
 */
export const shouldSend = (baseRev: number, ackedRev: number, currentRev: number): boolean =>
  currentRev <= Math.max(baseRev, ackedRev);

/** Parses a typed whole number; null when empty, fractional, signed or not numeric. */
export function parseWhole(text: string): number | null {
  const s = text.trim();
  return /^\d{1,9}$/.test(s) ? Number(s) : null;
}

export const clamp = (n: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, n));

/** `settings.update` patch that restores every default (rev and updatedAt are the worker's). */
export function resetPatch(): Omit<Settings, "rev" | "updatedAt"> {
  const { rev: _rev, updatedAt: _updatedAt, ...rest } = structuredClone(DEFAULT_SETTINGS);
  return rest;
}

/** Human size ("12.3 KB"). */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0 B";
  if (n < 1024) return `${Math.round(n)} B`;
  const units = ["KB", "MB", "GB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}
