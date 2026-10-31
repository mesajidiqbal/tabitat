/**
 * Backup reminder and backup stamp (docs/PHASE4.md §1, §3). `evaluateBackupReminder` runs on
 * the daily `backup-reminder` alarm, once at init, and when the cadence setting changes;
 * `recordBackup` runs after every backup produced through a command. Callers hold the lanes
 * (or run during init, before any command).
 */
import type { BackupReminder, ReminderDecision } from "../core/backup/reminder";
import { isBackupDue, reminderDecision, snoozeReminder } from "../core/backup/reminder";
import type { Meta, Settings } from "../core/model/types";
import { Keys } from "../core/model/types";
import type { BgContext } from "./context";
import { BgKeys, parseBackupReminder } from "./keys";

export function readBackupReminder(ctx: BgContext): Promise<BackupReminder | null> {
  return ctx.repo.read(BgKeys.backupReminder, parseBackupReminder);
}

/** Applies the reminder decision for the current meta/settings. Returns what was done. */
export async function evaluateBackupReminder(
  ctx: BgContext,
  settings?: Settings,
): Promise<ReminderDecision["action"]> {
  const { repo, ports } = ctx;
  const s = settings ?? (await repo.getSettings());
  const meta = await repo.getMeta();
  const record = await readBackupReminder(ctx);
  const d = reminderDecision(meta, s, record, ports.now());
  if (d.action === "write") await repo.setMany({ [BgKeys.backupReminder]: d.record });
  else if (d.action === "remove") await repo.remove(BgKeys.backupReminder);
  return d.action;
}

/**
 * `reminder.snooze`: keeps `dueSince`, sets `snoozedUntil = now + days`. A queued snooze can
 * arrive after the reminder was turned off (or a backup made it not due): with the reminder off
 * any record is removed, and when it is not currently due nothing is written (an existing
 * record is left to the regular evaluation).
 */
export async function snoozeBackupReminder(ctx: BgContext, days: number): Promise<void> {
  const { repo, ports } = ctx;
  const settings = await repo.getSettings();
  const record = await readBackupReminder(ctx);
  if (settings.backupReminderDays <= 0) {
    if (record) await repo.remove(BgKeys.backupReminder);
    return;
  }
  const meta = await repo.getMeta();
  const now = ports.now();
  if (meta === null || !isBackupDue(meta, settings.backupReminderDays, now)) return;
  await repo.setMany({ [BgKeys.backupReminder]: snoozeReminder(record, days, now) });
}

/**
 * A backup was produced: `meta.lastBackupAt = now` and the reminder record is removed. A
 * missing/unreadable meta is left alone (init rebuilds it); the reminder is still cleared.
 */
export async function recordBackup(ctx: BgContext): Promise<void> {
  const { repo, ports } = ctx;
  const meta = await repo.getMeta();
  if (meta) {
    const next: Meta = { ...meta, lastBackupAt: Math.max(1, Math.floor(ports.now())) };
    await repo.setMany({ [Keys.meta]: next });
  }
  await repo.remove(BgKeys.backupReminder);
}
