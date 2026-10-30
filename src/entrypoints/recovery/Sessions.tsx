/** "Session snapshots": generations (sessions:index + sessions:gen:<n>), restore, export. */
import { useState } from "preact/hooks";
import type { SessionGeneration } from "@/core/model/types";
import { Keys } from "@/core/model/types";
import { plural, t } from "@/i18n";
import { send } from "@/messaging/client";
import { errorText } from "@/ui/actions";
import c from "@/ui/components/controls.module.css";
import { absTime, downloadJson, relTime } from "@/ui/format";
import { useStorageKey } from "@/ui/hooks/useStorageKey";
import { store } from "@/ui/store";
import s from "./recovery.module.css";
import { type Status, StatusLine, TabList } from "./shared";

function Generation({ n, onStatus }: { n: number; onStatus: (s: Status) => void }) {
  const gen = useStorageKey<SessionGeneration>(Keys.sessionGen(n)).value;
  if (!gen || !Array.isArray(gen.windows)) return null;
  const tabs = gen.windows.reduce((sum, w) => sum + w.tabs.length, 0);
  const restore = () =>
    send("session.restore", { generation: gen.id }).then(
      () => onStatus({ kind: "ok", text: t("restoredGeneration", absTime(gen.takenAt)) }),
      (e: unknown) => onStatus({ kind: "err", text: errorText(e) }),
    );
  return (
    <li class={s.item} data-testid="generation">
      <div class={s.grow}>
        <strong>{absTime(gen.takenAt)}</strong>{" "}
        <span class={s.muted}>({relTime(gen.takenAt)})</span>
        <div class={s.muted}>
          {plural(gen.windows.length, "windowsOne", "windowsMany")} ·{" "}
          {plural(tabs, "tabsOne", "tabsMany")}
        </div>
      </div>
      <button type="button" class={c.btn} onClick={() => void restore()} disabled={tabs === 0}>
        {t("restoreNewWindow")}
      </button>
      {gen.windows.map((w, i) => (
        <TabList
          key={`${w.windowId}-${i}`}
          tabs={w.tabs}
          label={`${(w.workspaceId && store.metas.value[w.workspaceId]?.name) || t("windowN", i + 1)} — ${plural(w.tabs.length, "tabsOne", "tabsMany")}`}
        />
      ))}
    </li>
  );
}

export function Sessions() {
  const index = useStorageKey<number[]>(Keys.sessionsIndex).value;
  const [status, setStatus] = useState<Status>(null);
  const gens = Array.isArray(index)
    ? [...index].filter((n) => typeof n === "number").reverse()
    : [];
  const exportJson = () =>
    send("backup.export", {}).then(
      (file) =>
        downloadJson(
          `tabitat-backup-${new Date(file.exportedAt).toISOString().slice(0, 10)}.json`,
          file,
        ),
      (e: unknown) => setStatus({ kind: "err", text: errorText(e) }),
    );
  const snapshot = () =>
    send("session.snapshotNow", {}).then(
      () => setStatus({ kind: "ok", text: t("snapshotTaken") }),
      (e: unknown) => setStatus({ kind: "err", text: errorText(e) }),
    );
  return (
    <section class={s.card} aria-labelledby="ses-h">
      <div class={s.cardHead}>
        <h2 id="ses-h">{t("sessionsTitle")}</h2>
        <button type="button" class={c.btn} onClick={() => void snapshot()}>
          {t("snapshotNow")}
        </button>
        <button type="button" class={c.btn} onClick={() => void exportJson()}>
          {t("exportJson")}
        </button>
      </div>
      <p class={s.muted}>{t("sessionsLead")}</p>
      <StatusLine status={status} />
      {gens.length === 0 ? (
        <p class={s.muted}>{t("noSessions")}</p>
      ) : (
        <ul class={s.list}>
          {gens.map((n) => (
            <Generation key={n} n={n} onStatus={setStatus} />
          ))}
        </ul>
      )}
    </section>
  );
}
