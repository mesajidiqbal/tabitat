/** Small helpers for the recovery page. */
import { useEffect, useState } from "preact/hooks";
import type { SavedTab } from "@/core/model/types";
import { t } from "@/i18n";
import { errorInfo } from "@/ui/actions";
import c from "@/ui/components/controls.module.css";
import { hostLabel } from "@/ui/format";
import s from "./recovery.module.css";

/** Two-step destructive button: first click arms it ("Confirm …") for 4 s. */
export function ConfirmButton(p: {
  label: string;
  confirm: string;
  onConfirm: () => void;
  disabled?: boolean;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const id = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(id);
  }, [armed]);
  return (
    <button
      type="button"
      class={`${c.btn} ${c.dangerBtn}`}
      disabled={p.disabled}
      onClick={() => {
        if (!armed) return setArmed(true);
        setArmed(false);
        p.onConfirm();
      }}
    >
      {armed ? p.confirm : p.label}
    </button>
  );
}

/** Expandable tab list (native <details>). */
export function TabList(p: {
  tabs: ReadonlyArray<Pick<SavedTab, "id" | "url" | "title">>;
  label?: string;
}) {
  // Stored records can be malformed: skip entries that are not objects.
  const tabs = Array.isArray(p.tabs)
    ? p.tabs.filter((x) => typeof x === "object" && x !== null)
    : [];
  return (
    <details class={s.details}>
      <summary>{p.label ?? t("showTabs", tabs.length)}</summary>
      <ol class={s.tabs}>
        {tabs.map((tab) => (
          <li key={tab.id} title={tab.url}>
            {tab.title || tab.url} <span class={s.url}>— {hostLabel(tab.url)}</span>
          </li>
        ))}
      </ol>
    </details>
  );
}

/** `detail`: raw worker / browser message, shown as the line's tooltip. */
export type Status = { kind: "ok" | "err"; text: string; detail?: string } | null;

/** Error status line for a failed action: localized sentence + raw detail. */
export const errStatus = (e: unknown): Status => ({ kind: "err", ...errorInfo(e) });

export function StatusLine({ status }: { status: Status }) {
  if (!status) return null;
  return (
    <p
      class={`${s.notice} ${status.kind === "err" ? s.err : ""}`}
      role={status.kind === "err" ? "alert" : "status"}
      title={status.detail || undefined}
    >
      {status.text}
    </p>
  );
}
