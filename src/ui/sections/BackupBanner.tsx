import { useState } from "preact/hooks";
import { Keys, type Meta } from "@/core/model/types";
import { plural, t } from "@/i18n";
import { send } from "@/messaging/client";
import c from "../components/controls.module.css";
import { useStorageKey } from "../hooks/useStorageKey";
import { errorLine } from "../options/errors";
import s from "./backupBanner.module.css";
import {
  BACKUP_REMINDER_KEY,
  daysSinceBackup,
  parseBannerSettings,
  parseReminder,
  reminderVisible,
} from "./backupReminder";

const SNOOZE_DAYS = 7;

/**
 * "Last backup N days ago · Export · Remind me in a week · Turn off". Shown while the worker's
 * `backup:reminder` record exists, is not snoozed and the reminder is on; the three actions are its only dismissal
 * (an export or turning the reminder off makes the worker remove the record).
 * `onTurnOff`: overrides the default `settings.update` (the options page routes it through its
 * settings model for the "Saved" indicator and conflict handling).
 */
export function BackupBanner(p: {
  variant?: "popup" | "page";
  onTurnOff?: () => Promise<unknown>;
}) {
  const record = useStorageKey(BACKUP_REMINDER_KEY, parseReminder).value;
  const meta = useStorageKey<Meta>(Keys.meta).value;
  const settings = useStorageKey(Keys.settings, parseBannerSettings).value;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; detail: string } | null>(null);

  const now = Date.now();
  if (!reminderVisible(record, now, settings?.backupReminderDays)) return null;

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(errorLine(e));
    }
    setBusy(false);
  };
  // Without the override the write needs the stored rev: never a guessed one (Gemini review).
  const canTurnOff = p.onTurnOff !== undefined || settings !== undefined;
  const turnOff = async () => {
    if (p.onTurnOff) return p.onTurnOff();
    if (!settings) return;
    return send("settings.update", {
      patch: { backupReminderDays: 0 },
      expectedRev: settings.rev,
    });
  };
  // Loaded on click: the export code stays out of the popup's first-load bundle.
  const exportBackup = () => import("../exportActions").then((m) => m.exportJsonBackup());

  const days = daysSinceBackup(meta?.lastBackupAt, now);
  const message =
    days === null
      ? t("backupBannerNone")
      : days === 0
        ? t("backupBannerToday")
        : plural(days, "backupBannerAgoOne", "backupBannerAgoMany");
  return (
    <div
      class={`${s.banner} ${p.variant === "page" ? s.page : s.popup}`}
      role="status"
      data-testid="backup-banner"
    >
      <span class={s.text}>{message}</span>
      <div class={s.actions}>
        <button type="button" class={c.btn} disabled={busy} onClick={() => void run(exportBackup)}>
          {t("backupBannerExport")}
        </button>
        <button
          type="button"
          class={c.btn}
          disabled={busy}
          onClick={() => void run(() => send("reminder.snooze", { days: SNOOZE_DAYS }))}
        >
          {t("backupBannerSnooze")}
        </button>
        <button
          type="button"
          class={c.btn}
          disabled={busy || !canTurnOff}
          onClick={() => void run(turnOff)}
        >
          {t("backupBannerOff")}
        </button>
      </div>
      {error && (
        <span class={s.err} role="alert" title={error.detail || undefined}>
          {error.text}
        </span>
      )}
    </div>
  );
}
