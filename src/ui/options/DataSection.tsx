import { useEffect, useState } from "preact/hooks";
import { Keys } from "@/core/model/types";
import { plural, t } from "@/i18n";
import { send } from "@/messaging/client";
import c from "../components/controls.module.css";
import { downloadJson } from "../format";
import { useStorageKey } from "../hooks/useStorageKey";
import { ConfirmAction, type Line, LineView } from "./actions";
import { errorLine } from "./errors";
import { Group, Section } from "./fields";
import s from "./options.module.css";
import { useSettingsApi } from "./SettingsContext";
import { formatBytes, resetPatch } from "./settings";

const trashCount = (raw: unknown): number => {
  const items = (raw as { items?: unknown } | undefined)?.items;
  return Array.isArray(items) ? items.length : 0;
};

/** Bytes used in storage.local; re-read when `dep` changes (trash edits, resets). */
function useBytesInUse(dep: unknown): number | null {
  const [bytes, setBytes] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    chrome.storage.local.getBytesInUse(null).then(
      (n) => alive && setBytes(n),
      () => alive && setBytes(null),
    );
    return () => {
      alive = false;
    };
  }, [dep]);
  return bytes;
}

export function DataSection() {
  const { update } = useSettingsApi();
  const trash = trashCount(useStorageKey(Keys.trash).value);
  const bytes = useBytesInUse(trash);
  const [line, setLine] = useState<Line>(null);

  const fail = (e: unknown) => {
    const err = errorLine(e);
    setLine({ ok: false, text: err.text, detail: err.detail });
  };
  const exportBackup = async () => {
    try {
      const file = await send("backup.export", {});
      const day = new Date(file.exportedAt).toISOString().slice(0, 10);
      downloadJson(`tabitat-backup-${day}.json`, file);
      setLine(null);
    } catch (e) {
      fail(e);
    }
  };
  const emptyTrash = async () => {
    try {
      await send("trash.purge", {});
      setLine({ ok: true, text: t("trashEmptied") });
    } catch (e) {
      fail(e);
    }
  };
  const reset = async () => {
    if (await update("data", resetPatch())) setLine({ ok: true, text: t("optResetDone") });
  };

  return (
    <Section id="data" title={t("optData")}>
      <Group title={t("optDataBackup")}>
        <p class={s.hint}>{t("optDataBackupLead")}</p>
        <div class={s.row}>
          <button type="button" class={c.btn} onClick={() => void exportBackup()}>
            {t("exportBackup")}
          </button>
          <a class={s.link} href="recovery.html" target="_blank" rel="noopener">
            {t("optDataImport")}
          </a>
        </div>
      </Group>
      <Group title={t("optDataStorage")}>
        <p>{bytes === null ? "…" : t("optDataUsage", formatBytes(bytes))}</p>
        <p>{plural(trash, "optTrashOne", "optTrashMany")}</p>
        <ConfirmAction
          label={t("emptyTrash")}
          prompt={t("optEmptyTrashPrompt", trash)}
          disabled={trash === 0}
          onConfirm={() => void emptyTrash()}
        />
      </Group>
      <Group title={t("optDataReset")}>
        <p class={s.hint}>{t("optResetLead")}</p>
        <ConfirmAction
          label={t("optDataReset")}
          prompt={t("optResetPrompt")}
          onConfirm={() => void reset()}
        />
      </Group>
      <LineView line={line} />
    </Section>
  );
}
