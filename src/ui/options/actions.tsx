/** Action controls for the options sections: inline confirm and result lines. */
import { useEffect, useId, useRef, useState } from "preact/hooks";
import { t } from "@/i18n";
import c from "../components/controls.module.css";
import s from "./options.module.css";

/**
 * Inline two-step confirmation for a destructive action (no `confirm()` dialog). Opening it moves
 * focus to the confirm button; Tab / Shift+Tab cycle inside it (focus trap); Escape cancels;
 * focus returns to the trigger afterwards.
 */
export function ConfirmAction(p: {
  label: string;
  prompt: string;
  disabled?: boolean;
  onConfirm: () => void;
}) {
  const [asking, setAsking] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const confirm = useRef<HTMLButtonElement>(null);
  const restore = useRef(false);
  const promptId = useId();
  useEffect(() => {
    if (asking) confirm.current?.focus();
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
    <div
      class={s.confirm}
      role="alertdialog"
      aria-label={p.label}
      aria-describedby={promptId}
      onKeyDown={(e) => {
        if (e.key === "Tab") {
          const list = [...e.currentTarget.querySelectorAll<HTMLElement>("button")];
          const i = list.indexOf(document.activeElement as HTMLElement);
          const next = list[(i + (e.shiftKey ? -1 : 1) + list.length) % list.length];
          e.preventDefault();
          next?.focus();
          return;
        }
        if (e.key !== "Escape") return;
        e.preventDefault();
        e.stopPropagation();
        close();
      }}
    >
      <span id={promptId}>{p.prompt}</span>
      <button
        ref={confirm}
        type="button"
        class={`${c.btn} ${c.dangerBtn}`}
        onClick={() => {
          close();
          p.onConfirm();
        }}
      >
        {t("optConfirm")}
      </button>
      <button type="button" class={c.btn} onClick={close}>
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
