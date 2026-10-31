/** Backup reminder helpers (pure): the `backup:reminder` record and the banner's decisions. */

/** storage.local key written by the worker's daily `backup-reminder` alarm. */
export const BACKUP_REMINDER_KEY = "backup:reminder";

export interface ReminderRecord {
  dueSince: number;
  snoozedUntil?: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const finite = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

/** Defensive parse of the stored record (the UI reads storage directly); null when unusable. */
export function parseReminder(raw: unknown): ReminderRecord | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (!finite(r.dueSince)) return null;
  const out: ReminderRecord = { dueSince: r.dueSince };
  if (finite(r.snoozedUntil)) out.snoozedUntil = r.snoozedUntil;
  return out;
}

/**
 * The banner shows when a record exists and is not snoozed (no snooze, or it has ended), unless
 * the reminder is turned off (`backupReminderDays === 0`): a stale record never shows then.
 * `days` is undefined while the settings are not known yet.
 */
export function reminderVisible(
  record: ReminderRecord | null | undefined,
  now: number,
  days?: number,
): boolean {
  if (!record || days === 0) return false;
  return record.snoozedUntil === undefined || record.snoozedUntil <= now;
}

/** Whole days since the last backup; null when there was none (or the stamp is unusable). */
export function daysSinceBackup(lastBackupAt: unknown, now: number): number | null {
  if (!finite(lastBackupAt)) return null;
  return Math.max(0, Math.floor((now - lastBackupAt) / DAY_MS));
}

/** What the banner needs from `settings`; undefined when the record is missing or unusable. */
export interface BannerSettings {
  rev: number;
  backupReminderDays: number;
}

const DEFAULT_REMINDER_DAYS = 30;
const count = (x: unknown): x is number => typeof x === "number" && Number.isInteger(x) && x >= 0;

/** Small settings parse (the options page's full parser is not loaded in the popup). */
export function parseBannerSettings(raw: unknown): BannerSettings | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  if (!count(r.rev)) return undefined;
  return {
    rev: r.rev,
    backupReminderDays: count(r.backupReminderDays) ? r.backupReminderDays : DEFAULT_REMINDER_DAYS,
  };
}
