/** "Backup and export": JSON backup and bookmarks-HTML export of everything. */
import { useState } from "preact/hooks";
import { t } from "@/i18n";
import c from "@/ui/components/controls.module.css";
import { exportHtmlBackup, exportJsonBackup, useStripQuery } from "@/ui/exportActions";
import s from "./recovery.module.css";
import { errStatus, type Status, StatusLine } from "./shared";

export function Data() {
  const [status, setStatus] = useState<Status>(null);
  const [stripQuery, setStripQuery] = useStripQuery();
  const run = (action: () => Promise<void>) =>
    action().then(
      () => setStatus(null),
      (e: unknown) => setStatus(errStatus(e)),
    );
  return (
    <section class={s.card} aria-labelledby="data-h">
      <div class={s.cardHead}>
        <h2 id="data-h">{t("recoveryDataTitle")}</h2>
      </div>
      <p class={s.muted}>{t("recoveryDataLead")}</p>
      <div class={s.row}>
        <button type="button" class={c.btn} onClick={() => void run(exportJsonBackup)}>
          {t("exportBackup")}
        </button>
        <button
          type="button"
          class={c.btn}
          onClick={() => void run(() => exportHtmlBackup(stripQuery))}
        >
          {t("exportHtml")}
        </button>
        <label class={s.check}>
          <input
            type="checkbox"
            checked={stripQuery}
            onChange={(e) => setStripQuery((e.currentTarget as HTMLInputElement).checked)}
          />
          <span title={t("stripQueryHint")}>{t("stripQueryStrings")}</span>
        </label>
      </div>
      <StatusLine status={status} />
    </section>
  );
}
