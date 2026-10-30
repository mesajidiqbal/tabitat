/** "Interrupted switch": entries of recovery:pending (abandoned switch ops). */
import { useState } from "preact/hooks";
import type { RecoveryEntry } from "@/background/keys";
import { buildPlaceholderUrl, classifyUrl } from "@/core/ops/url";
import { t } from "@/i18n";
import { send } from "@/messaging/client";
import { errorText } from "@/ui/actions";
import c from "@/ui/components/controls.module.css";
import { absTime } from "@/ui/format";
import { store } from "@/ui/store";
import s from "./recovery.module.css";
import { type Status, StatusLine, TabList } from "./shared";

/** Lazy placeholders for web pages; chrome:/about: pages directly; anything else is skipped. */
function incomingUrls(e: RecoveryEntry): string[] {
  const base = chrome.runtime.getURL("/suspended.html");
  return e.incoming.flatMap((tab) => {
    const mode = classifyUrl(tab.url);
    if (mode === "skip") return [];
    return mode === "placeholder"
      ? [buildPlaceholderUrl(base, { u: tab.url, t: tab.title, w: e.to, s: tab.id })]
      : [tab.url];
  });
}

export function Interrupted() {
  const entries = store.recovery.value?.entries ?? [];
  const [status, setStatus] = useState<Status>(null);
  if (entries.length === 0) return null;
  const name = (id: string | null) =>
    id === null ? t("noWorkspace") : (store.metas.value[id]?.name ?? t("missingWorkspace", id));

  const open = async (e: RecoveryEntry) => {
    const urls = incomingUrls(e);
    if (urls.length === 0) return setStatus({ kind: "err", text: t("nothingToOpen") });
    try {
      await chrome.windows.create({ url: urls, focused: true });
      setStatus({ kind: "ok", text: t("openedTabs", urls.length) });
    } catch (err) {
      setStatus({ kind: "err", text: errorText(err) });
    }
  };
  const dismiss = (e: RecoveryEntry) =>
    send("recovery.dismiss", { opIds: [e.opId] }).then(
      () => setStatus(null),
      (err: unknown) => setStatus({ kind: "err", text: errorText(err) }),
    );

  return (
    <section class={`${s.card} ${s.warn}`} aria-labelledby="int-h">
      <div class={s.cardHead}>
        <h2 id="int-h">{t("interruptedTitle")}</h2>
      </div>
      <p class={s.muted}>{t("interruptedLead")}</p>
      <ul class={s.list}>
        {entries.map((e) => (
          <li key={e.opId} class={s.item}>
            <div class={s.grow}>
              <strong>{t("fromTo", [name(e.from), name(e.to)])}</strong>
              <div class={s.muted}>
                {absTime(e.abandonedAt)} · {t("stageReason", [e.stage, e.reason])}
              </div>
            </div>
            <div class={s.actions}>
              <button type="button" class={`${c.btn} ${c.primary}`} onClick={() => void open(e)}>
                {t("openIncoming")}
              </button>
              <button type="button" class={c.btn} onClick={() => void dismiss(e)}>
                {t("dismiss")}
              </button>
            </div>
            <TabList tabs={e.incoming} label={t("incomingTabs", e.incoming.length)} />
            {e.fromSnapshot && (
              <TabList
                tabs={e.fromSnapshot.tabs}
                label={t("outgoingTabs", e.fromSnapshot.tabs.length)}
              />
            )}
          </li>
        ))}
      </ul>
      <StatusLine status={status} />
    </section>
  );
}
