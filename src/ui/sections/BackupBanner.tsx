import { useState } from "preact/hooks";
import { Keys, type Meta } from "@/core/model/types";
import { plural, t } from "@/i18n";
import { send } from "@/messaging/client";
import c from "../components/controls.module.css";
import { exportJsonBackup } from "../exportActions";
import { useStorageKey } from "../hooks/useStorageKey";
import { errorLine } from "../options/errors";
import { parseSettingsLoose } from "../options/settings";
import s from "./backupBanner.module.css";
import {
  BACKUP_REMINDER_KEY,
  daysSinceBackup,
  parseReminder,
  reminderVisible,
} from "./backupReminder";

const SNOOZE_DAYS = 7;

/**
 * "Last backup N days ago · Export · Remind me in a week · Turn off". Shown while the worker's
 * `backup:reminder` record exists and is not snoozed; the three actions are its only dismissal
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
  const settings = useStorageKey(Keys.settings, parseSettingsLoose).value;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; detail: string } | null>(null);

  const now = Date.now();
  if (!reminderVisible(record, now)) return null;

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
  const turnOff = () =>
    p.onTurnOff
      ? p.onTurnOff()
      : send("settings.update", {
          patch: { backupReminderDays: 0 },
          expectedRev: settings?.rev ?? 0,
        });

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
        <button
          type="button"
          class={c.btn}
          disabled={busy}
          onClick={() => void run(exportJsonBackup)}
        >
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
        <button type="button" class={c.btn} disabled={busy} onClick={() => void run(turnOff)}>
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
