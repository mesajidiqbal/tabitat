/** "Import": backup file -> backup.import (merge / replace), with an explicit confirmation. */
import { useState } from "preact/hooks";
import { t } from "@/i18n";
import { sendEnvelope } from "@/messaging/client";
import type { ImportReport } from "@/messaging/commands";
import c from "@/ui/components/controls.module.css";
import { describeError } from "@/ui/errors";
import { absTime } from "@/ui/format";
import { IMPORT_FAILED_KEY, store } from "@/ui/store";
import s from "./recovery.module.css";
import { ConfirmButton } from "./shared";

type Mode = "merge" | "replace";

type Result = { ok: boolean; text: string; extra?: string } | null;

function FailedImport({ onResult }: { onResult: (r: Result) => void }) {
  const f = store.importFailed.value;
  if (!f) return null;
  const applied = Array.isArray(f.applied) ? f.applied : [];
  return (
    <div class={`${s.notice} ${s.err}`} role="alert">
      <strong>{t("importFailedTitle")}</strong>
      <p>
        {String(f.reason ?? "")} — {String(f.error ?? "")}
        {typeof f.at === "number" ? ` (${absTime(f.at)})` : ""}
      </p>
      {f.partial === true && <p>{t("importPartial", applied.length)}</p>}
      {applied.length > 0 && <pre class={s.pre}>{applied.join("\n")}</pre>}
      <button
        type="button"
        class={c.btn}
        onClick={() =>
          void sendEnvelope("system.purgeCorrupt", { keys: [IMPORT_FAILED_KEY] }).then((env) => {
            if (env.ok) return onResult(null);
            const err = describeError(env.code, env.message);
            onResult({ ok: false, text: err.text, extra: err.detail });
          })
        }
      >
        {t("dismiss")}
      </button>
    </div>
  );
}

export function ImportSection() {
  const [mode, setMode] = useState<Mode>("merge");
  const [file, setFile] = useState<{ name: string; data: unknown } | null>(null);
  const [result, setResult] = useState<Result>(null);
  const [busy, setBusy] = useState(false);

  const choose = async (e: Event) => {
    const input = e.currentTarget as HTMLInputElement;
    const f = input.files?.[0];
    input.value = "";
    setResult(null);
    if (!f) return;
    try {
      setFile({ name: f.name, data: JSON.parse(await f.text()) as unknown });
    } catch {
      setFile(null);
      setResult({ ok: false, text: t("importNotJson") });
    }
  };
  const run = async () => {
    if (!file) return;
    setBusy(true);
    const env = await sendEnvelope("backup.import", { file: file.data, mode });
    setBusy(false);
    if (env.ok) {
      const r: ImportReport = env.value;
      setFile(null);
      setResult({
        ok: true,
        text: t("importDone", [r.workspaces, r.todos, r.notes, r.quicklinks]),
        extra: r.warnings.join("\n"),
      });
    } else {
      const err = describeError(env.code, env.message);
      setResult({
        ok: false,
        text: err.text,
        extra: [err.detail, env.details ? JSON.stringify(env.details, null, 2) : ""]
          .filter(Boolean)
          .join("\n"),
      });
    }
  };

  return (
    <section class={s.card} aria-labelledby="imp-h">
      <div class={s.cardHead}>
        <h2 id="imp-h">{t("importTitle")}</h2>
      </div>
      <FailedImport onResult={setResult} />
      <fieldset class={s.fieldset}>
        <legend>{t("importMode")}</legend>
        {(["merge", "replace"] as const).map((m) => (
          <label key={m}>
            <input
              type="radio"
              name="mode"
              value={m}
              checked={mode === m}
              onChange={() => setMode(m)}
            />{" "}
            {m === "merge" ? t("modeMerge") : t("modeReplace")}
          </label>
        ))}
      </fieldset>
      <label class={s.muted}>
        {t("chooseBackup")}{" "}
        <input type="file" accept="application/json,.json" onChange={(e) => void choose(e)} />
      </label>
      {file && (
        <div class={`${s.notice} ${mode === "replace" ? s.warn : ""}`}>
          <p>
            {mode === "replace" ? t("confirmReplace", file.name) : t("confirmMerge", file.name)}
          </p>
          <div class={s.actions}>
            {mode === "replace" ? (
              <ConfirmButton
                label={t("replaceNow")}
                confirm={t("confirmReplaceNow")}
                disabled={busy}
                onConfirm={() => void run()}
              />
            ) : (
              <button
                type="button"
                class={`${c.btn} ${c.primary}`}
                disabled={busy}
                onClick={() => void run()}
              >
                {t("importNow")}
              </button>
            )}
            <button type="button" class={c.btn} onClick={() => setFile(null)}>
              {t("cancel")}
            </button>
          </div>
        </div>
      )}
      {result && (
        <div class={`${s.notice} ${result.ok ? "" : s.err}`} role={result.ok ? "status" : "alert"}>
          <p>{result.text}</p>
          {result.extra && <pre class={s.pre}>{result.extra}</pre>}
        </div>
      )}
    </section>
  );
}
