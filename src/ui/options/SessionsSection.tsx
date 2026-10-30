import { useState } from "preact/hooks";
import { t } from "@/i18n";
import { send } from "@/messaging/client";
import c from "../components/controls.module.css";
import { type Line, LineView } from "./actions";
import { errorLine } from "./errors";
import { Group, NumberField, Section } from "./fields";
import s from "./options.module.css";
import { useSettingsApi } from "./SettingsContext";
import { RANGES } from "./settings";

export function SessionsSection() {
  const { settings, update } = useSettingsApi();
  const [line, setLine] = useState<Line>(null);
  const [busy, setBusy] = useState(false);
  const snapshot = async () => {
    setBusy(true);
    try {
      await send("session.snapshotNow", {});
      setLine({ ok: true, text: t("snapshotTaken") });
    } catch (e) {
      const err = errorLine(e);
      setLine({ ok: false, text: err.text, detail: err.detail });
    }
    setBusy(false);
  };
  return (
    <Section id="sessions" title={t("optSessions")} lead={t("optSessionsLead")}>
      <Group>
        <NumberField
          label={t("optSessionsEvery")}
          value={settings.sessions.everyMinutes}
          {...RANGES.snapshotEvery}
          onCommit={(n) => void update("sessions", { sessions: { everyMinutes: n } })}
        />
        <NumberField
          label={t("optSessionsKeep")}
          hint={t("optSessionsKeepHint")}
          value={settings.sessions.keep}
          {...RANGES.snapshotKeep}
          onCommit={(n) => void update("sessions", { sessions: { keep: n } })}
        />
        <div class={s.row}>
          <button type="button" class={c.btn} disabled={busy} onClick={() => void snapshot()}>
            {t("optSnapshotNow")}
          </button>
          <a class={s.link} href="recovery.html" target="_blank" rel="noopener">
            {t("optOpenRecovery")}
          </a>
        </div>
        <LineView line={line} />
      </Group>
    </Section>
  );
}
