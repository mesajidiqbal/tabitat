/** Action controls for the options sections: inline confirm and result lines. */
import { useEffect, useId, useRef, useState } from "preact/hooks";
import { t } from "@/i18n";
import c from "../components/controls.module.css";
import s from "./options.module.css";

/**
 * Inline two-step confirmation for a destructive action (no `confirm()` dialog). It is part of
 * the page, not an overlay, so it does not claim to be modal (review C3.4): a `group` labelled by
 * its prompt, no focus trap. Opening it moves focus to Cancel (the least destructive choice);
 * Escape cancels; focus returns to the trigger afterwards.
 */
export function ConfirmAction(p: {
  label: string;
  prompt: string;
  disabled?: boolean;
  onConfirm: () => void;
}) {
  const [asking, setAsking] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const restore = useRef(false);
  const promptId = useId();
  useEffect(() => {
    if (asking) cancel.current?.focus();
    else if (restore.current) {
      restore.current = false;
      trigger.current?.focus();
    }
  }, [asking]);
  const close = () => {
    restore.current = true;
    setAsking(false);
  };
  if (!asking) {
    return (
      <button
        ref={trigger}
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
    // biome-ignore lint/a11y/useSemanticElements: an inline button group, not a form fieldset
    <div
      class={s.confirm}
      role="group"
      aria-labelledby={promptId}
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.preventDefault();
        e.stopPropagation();
        close();
      }}
    >
      <span id={promptId}>{p.prompt}</span>
      <button
        type="button"
        class={`${c.btn} ${c.dangerBtn}`}
        onClick={() => {
          close();
          p.onConfirm();
        }}
      >
        {t("optConfirm")}
      </button>
      <button ref={cancel} type="button" class={c.btn} onClick={close}>
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
