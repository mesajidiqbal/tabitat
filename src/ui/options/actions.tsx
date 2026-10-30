/** Action controls for the options sections: inline confirm and result lines. */
import { useState } from "preact/hooks";
import { t } from "@/i18n";
import c from "../components/controls.module.css";
import s from "./options.module.css";

/** Inline two-step confirmation for a destructive action (no `confirm()` dialog). */
export function ConfirmAction(p: {
  label: string;
  prompt: string;
  disabled?: boolean;
  onConfirm: () => void;
}) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <button
        type="button"
        class={`${c.btn} ${c.dangerBtn}`}
        disabled={p.disabled}
        onClick={() => setAsking(true)}
      >
        {p.label}
      </button>
    );
  }
  return (
    <div class={s.confirm} role="alertdialog" aria-label={p.label}>
      <span>{p.prompt}</span>
      <button
        type="button"
        class={`${c.btn} ${c.dangerBtn}`}
        onClick={() => {
          setAsking(false);
          p.onConfirm();
        }}
      >
        {t("optConfirm")}
      </button>
      <button type="button" class={c.btn} onClick={() => setAsking(false)}>
        {t("cancel")}
      </button>
    </div>
  );
}

/** Result / error line under an action. */
export type Line = { ok: boolean; text: string; detail?: string } | null;

export function LineView({ line }: { line: Line }) {
  if (!line) return null;
  return (
    <p
      class={`${s.notice} ${line.ok ? "" : s.bad}`}
      role={line.ok ? "status" : "alert"}
      title={line.detail || undefined}
    >
      {line.text}
    </p>
  );
}
