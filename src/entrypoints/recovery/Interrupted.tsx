/** "Interrupted switch": entries of recovery:pending (abandoned switch ops). */
import { useState } from "preact/hooks";
import type { RecoveryEntry } from "@/background/keys";
import { buildPlaceholderUrl, classifyUrl } from "@/core/ops/url";
import { type MsgKey, t } from "@/i18n";
import { send } from "@/messaging/client";
import c from "@/ui/components/controls.module.css";
import { absTime } from "@/ui/format";
import { store } from "@/ui/store";
import s from "./recovery.module.css";
import { errStatus, type Status, StatusLine, TabList } from "./shared";

/** Entries can be malformed (not re-validated here): missing / non-array tab lists read as empty. */
const incomingOf = (e: RecoveryEntry) => (Array.isArray(e.incoming) ? e.incoming : []);
const outgoingOf = (e: RecoveryEntry) => {
  const tabs = typeof e.fromSnapshot === "object" && e.fromSnapshot ? e.fromSnapshot.tabs : null;
  return Array.isArray(tabs) ? tabs : null;
};

const STAGES: Record<string, MsgKey> = {
  snapshot: "stage_snapshot",
  opening: "stage_opening",
  activating: "stage_activating",
  closing: "stage_closing",
  done: "stage_done",
};
/** Reasons the worker writes (workspace-engine resumeOrAbandon, services window removal). */
const REASONS: Record<string, MsgKey> = {
  "session changed": "reason_session_changed",
  "window closed": "reason_window_closed",
  "window closed during the switch": "reason_window_closed_during_the_switch",
  "too many attempts": "reason_too_many_attempts",
  "tabs changed during the switch": "reason_tabs_changed_during_the_switch",
};
/** Localized stage / reason; unknown values are shown as stored. */
const label = (map: Record<string, MsgKey>, v: unknown): string => {
  const s = String(v ?? "");
  return Object.hasOwn(map, s) ? t(map[s] as MsgKey) : s;
};

/** Lazy placeholders for web pages; chrome:/about: pages directly; anything else is skipped. */
function incomingUrls(e: RecoveryEntry): string[] {
  const base = chrome.runtime.getURL("/suspended.html");
  return incomingOf(e).flatMap((tab) => {
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
      setStatus(errStatus(err));
    }
  };
  const dismiss = (e: RecoveryEntry) =>
    send("recovery.dismiss", { opIds: [e.opId] }).then(
      () => setStatus(null),
      (err: unknown) => setStatus(errStatus(err)),
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
                {absTime(e.abandonedAt)} ·{" "}
                {t("stageReason", [label(STAGES, e.stage), label(REASONS, e.reason)])}
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
            <TabList tabs={incomingOf(e)} label={t("incomingTabs", incomingOf(e).length)} />
            {outgoingOf(e) && (
              <TabList
                tabs={outgoingOf(e) ?? []}
                label={t("outgoingTabs", outgoingOf(e)?.length ?? 0)}
              />
            )}
          </li>
        ))}
      </ul>
      <StatusLine status={status} />
    </section>
  );
}
