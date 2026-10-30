/** One toast at a time (role=status). `showToast` / `useUndoToast` are callable from anywhere. */
import { signal } from "@preact/signals";
import { t } from "@/i18n";
import { IconClose } from "../icons";
import { IconButton } from "./IconButton";
import s from "./misc.module.css";

export interface ToastSpec {
  message: string;
  action?: { label: string; run: () => void };
  /** ms; default 4000. */
  duration?: number;
}

interface Shown extends ToastSpec {
  id: number;
}

const current = signal<Shown | null>(null);
let seq = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

export function showToast(spec: ToastSpec): void {
  clearTimeout(timer);
  const shown = { ...spec, id: ++seq };
  current.value = shown;
  timer = setTimeout(() => {
    if (current.peek()?.id === shown.id) current.value = null;
  }, spec.duration ?? 4000);
}

export function dismissToast(): void {
  clearTimeout(timer);
  current.value = null;
}

/** `(message, undo)` -> an 8 s toast with an Undo button. */
export function useUndoToast() {
  return (message: string, undo: () => void) =>
    showToast({ message, duration: 8000, action: { label: t("undo"), run: undo } });
}

export function Toast() {
  const toast = current.value;
  return (
    <div class={s.toastRegion} role="status" aria-live="polite">
      {toast && (
        <div class={s.toast} key={toast.id}>
          <span>{toast.message}</span>
          {toast.action && (
            <button
              type="button"
              class={s.toastAction}
              onClick={() => {
                toast.action?.run();
                dismissToast();
              }}
            >
              {toast.action.label}
            </button>
          )}
          <IconButton
            class={s.toastClose}
            label={t("dismiss")}
            icon={<IconClose size={14} />}
            onClick={dismissToast}
          />
        </div>
      )}
    </div>
  );
}
