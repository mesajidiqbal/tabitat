/** "Quarantined records" (corrupt:*): records that failed validation and were set aside. */
import { useEffect, useState } from "preact/hooks";
import { plural, t } from "@/i18n";
import { send } from "@/messaging/client";
import c from "@/ui/components/controls.module.css";
import { downloadJson } from "@/ui/download";
import { absTime } from "@/ui/format";
import { shouldApplyInitial } from "@/ui/hooks/useStorageKey";
import s from "./recovery.module.css";
import { ConfirmButton, errStatus, type Status, StatusLine } from "./shared";

const PREFIX = "corrupt:";

/** Every corrupt:* record (reads the whole store once, then follows onChanged). */
function useCorrupt(): Record<string, unknown> {
  const [recs, setRecs] = useState<Record<string, unknown>>({});
  useEffect(() => {
    // A change that arrives before the initial read resolves is newer: the read is dropped.
    let seenChange = false;
    void chrome.storage.local.get(null).then((all) => {
      if (!shouldApplyInitial(seenChange)) return;
      setRecs(Object.fromEntries(Object.entries(all).filter(([k]) => k.startsWith(PREFIX))));
    });
    const onChange = (ch: Record<string, chrome.storage.StorageChange>, area: string) => {
      const keys = Object.keys(ch).filter((k) => k.startsWith(PREFIX));
      if (area !== "local" || keys.length === 0) return;
      seenChange = true;
      setRecs((prev) => {
        const next = { ...prev };
        for (const k of keys) {
          if (ch[k]?.newValue === undefined) delete next[k];
          else next[k] = ch[k]?.newValue;
        }
        return next;
      });
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, []);
  return recs;
}

const field = (v: unknown, k: string) =>
  typeof v === "object" && v !== null ? (v as Record<string, unknown>)[k] : undefined;

export function Quarantine() {
  const recs = useCorrupt();
  const [status, setStatus] = useState<Status>(null);
  const keys = Object.keys(recs).sort();
  if (keys.length === 0) return null;
  const purge = () =>
    send("system.purgeCorrupt", {}).then(
      (n) => setStatus({ kind: "ok", text: plural(n, "deletedRecordsOne", "deletedRecordsMany") }),
      (e: unknown) => setStatus(errStatus(e)),
    );
  return (
    <section class={s.card} aria-labelledby="q-h">
      <div class={s.cardHead}>
        <h2 id="q-h">
          {t("quarantineTitle")} ({keys.length})
        </h2>
        <button
          type="button"
          class={c.btn}
          onClick={() => downloadJson(`tabitat-quarantine-${Date.now()}.json`, recs)}
        >
          {t("download")}
        </button>
        <ConfirmButton
          label={t("delete")}
          confirm={t("confirmDeleteAll")}
          onConfirm={() => void purge()}
        />
      </div>
      <p class={s.muted}>{t("quarantineLead")}</p>
      <ul class={s.list}>
        {keys.map((k) => {
          const at = field(recs[k], "at");
          return (
            <li key={k} class={s.item}>
              <div class={s.grow}>
                <code>{String(field(recs[k], "key") ?? k.slice(PREFIX.length))}</code>
                <div class={s.muted}>
                  {String(field(recs[k], "error") ?? "")}
                  {typeof at === "number" ? ` · ${absTime(at)}` : ""}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      <StatusLine status={status} />
    </section>
  );
}
