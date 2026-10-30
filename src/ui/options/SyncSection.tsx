import { useState } from "preact/hooks";
import { t } from "@/i18n";
import { send } from "@/messaging/client";
import c from "../components/controls.module.css";
import { absTime } from "../format";
import { useStorageKey } from "../hooks/useStorageKey";
import { type Line, LineView } from "./actions";
import { errorLine } from "./errors";
import { Group, Section, Toggle } from "./fields";
import s from "./options.module.css";
import { useSettingsApi } from "./SettingsContext";
import { parseSyncStatus, SYNC_STATUS_KEY, syncErrorKey } from "./sync-status";

export function SyncSection() {
  const { settings, update } = useSettingsApi();
  const status = parseSyncStatus(useStorageKey(SYNC_STATUS_KEY, parseSyncStatus).value);
  const [line, setLine] = useState<Line>(null);
  const [busy, setBusy] = useState(false);
  const on = settings.syncSettings;

  const syncNow = async () => {
    setBusy(true);
    setLine(null);
    try {
      const out = await send("settings.syncNow", {});
      setLine(
        out.error
          ? { ok: false, text: t(syncErrorKey(out.error), out.error) }
          : { ok: true, text: t("optSyncDone") },
      );
    } catch (e) {
      const err = errorLine(e);
      setLine({ ok: false, text: err.text, detail: err.detail });
    }
    setBusy(false);
  };

  return (
    <Section id="sync" title={t("optSync")} lead={t("optSyncPrivacy")}>
      <Group>
        <Toggle
          label={t("optSyncEnable")}
          checked={on}
          onChange={(v) => void update("sync", { syncSettings: v })}
        />
        <div class={s.field} aria-live="polite">
          {!on ? (
            <p class={s.hint}>{t("optSyncOff")}</p>
          ) : (
            <>
              {status.lastPushAt === undefined && status.lastPullAt === undefined && (
                <p class={s.hint}>{t("optSyncNever")}</p>
              )}
              {status.lastPushAt !== undefined && (
                <p class={s.hint}>{t("optSyncLastPush", absTime(status.lastPushAt))}</p>
              )}
              {status.lastPullAt !== undefined && (
                <p class={s.hint}>{t("optSyncLastPull", absTime(status.lastPullAt))}</p>
              )}
              {status.error && (
                <p class={s.err} role="alert" title={status.error}>
                  {t(syncErrorKey(status.error), status.error)}
                </p>
              )}
            </>
          )}
        </div>
        <div class={s.row}>
          <button type="button" class={c.btn} disabled={!on || busy} onClick={() => void syncNow()}>
            {t("optSyncNow")}
          </button>
        </div>
        <LineView line={line} />
      </Group>
    </Section>
  );
}
