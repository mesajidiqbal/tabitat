/**
 * Backup reminder decision (docs/PHASE4.md §1, §3). Pure: the worker reads `meta`, `settings`
 * and the `backup:reminder` record, asks what to do, and applies it.
 *
 * Due when `now - (meta.lastBackupAt ?? meta.installedAt) > backupReminderDays` days. While
 * due and not snoozed the record is `{ dueSince }` (kept from an earlier record, an expired
 * snooze is dropped); a live snooze is left alone; not due (or the reminder is off) removes it.
 */
import type { Meta, Settings } from "../model/types";

export const DAY_MS = 24 * 60 * 60 * 1000;

/** Value of the `backup:reminder` key. */
export interface BackupReminder {
  dueSince: number;
  snoozedUntil?: number;
}

export type ReminderDecision =
  | { action: "keep" }
  | { action: "remove" }
  | { action: "write"; record: BackupReminder };

export function isBackupDue(
  meta: Pick<Meta, "installedAt" | "lastBackupAt">,
  days: number,
  now: number,
): boolean {
  if (days <= 0) return false;
  return now - (meta.lastBackupAt ?? meta.installedAt) > days * DAY_MS;
}

export function reminderDecision(
  meta: Pick<Meta, "installedAt" | "lastBackupAt"> | null,
  settings: Pick<Settings, "backupReminderDays">,
  record: BackupReminder | null,
  now: number,
): ReminderDecision {
  const remove = (): ReminderDecision => (record ? { action: "remove" } : { action: "keep" });
  if (settings.backupReminderDays <= 0) return remove();
  // Without a readable meta nothing can be decided: leave things as they are.
  if (meta === null) return { action: "keep" };
  if (!isBackupDue(meta, settings.backupReminderDays, now)) return remove();
  if (record?.snoozedUntil !== undefined && record.snoozedUntil > now) return { action: "keep" };
  const next: BackupReminder = { dueSince: record?.dueSince ?? now };
  if (record && record.snoozedUntil === undefined && record.dueSince === next.dueSince) {
    return { action: "keep" };
  }
  return { action: "write", record: next };
}

/** The record after "remind me in `days` days". */
export function snoozeReminder(
  record: BackupReminder | null,
  days: number,
  now: number,
): BackupReminder {
  return { dueSince: record?.dueSince ?? now, snoozedUntil: now + days * DAY_MS };
}
