/** Widget frame: a titled card on the dashboard, a bare block (controls only) when compact. */
import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import type { Scope } from "@/core/model/types";
import { t } from "@/i18n";
import { activeMeta } from "../store";
import s from "./widgets.module.css";

export interface WidgetProps {
  /** Side panel variant: no card chrome or title (the section header has it). */
  compact?: boolean;
}

export function Card(p: {
  id: string;
  title: string;
  compact?: boolean | undefined;
  actions?: ComponentChildren;
  children?: ComponentChildren;
}) {
  const hid = `w-${p.id}-h`;
  return (
    <section
      class={p.compact ? s.compact : s.card}
      aria-labelledby={p.compact ? undefined : hid}
      aria-label={p.compact ? p.title : undefined}
      data-widget={p.id}
    >
      {(!p.compact || p.actions) && (
        <div class={s.head}>
          {p.compact ? (
            <span class={s.title} />
          ) : (
            <h2 class={s.title} id={hid}>
              {p.title}
            </h2>
          )}
          {p.actions}
        </div>
      )}
      <div class={s.body}>{p.children}</div>
    </section>
  );
}

/** Fixed-height placeholder while a widget chunk or its record loads (no layout shift). */
export function Skeleton({ small }: { small?: boolean }) {
  return <div class={`${s.skeleton} ${small ? s.skeletonSm : ""}`} aria-hidden="true" />;
}

export type ScopeMode = "global" | "workspace";

/** Global vs the window's active workspace; falls back to global when there is none. */
export function useScope() {
  const [mode, setMode] = useState<ScopeMode>("global");
  const meta = activeMeta.value;
  const scope: Scope = mode === "workspace" && meta ? meta.id : "global";
  const wsName = meta ? (meta.kind === "unsorted" ? t("unsorted") : meta.name) : null;
  return { mode: meta ? mode : "global", setMode, scope, wsName };
}

export function ScopeSwitch(p: {
  mode: ScopeMode;
  setMode: (m: ScopeMode) => void;
  wsName: string | null;
  label: string;
}) {
  if (p.wsName === null) return null;
  return (
    // biome-ignore lint/a11y/useSemanticElements: a two-button toggle group, not a form fieldset
    <div class={s.seg} role="group" aria-label={p.label}>
      <button type="button" aria-pressed={p.mode === "global"} onClick={() => p.setMode("global")}>
        {t("dashScopeGlobal")}
      </button>
      <button
        type="button"
        aria-pressed={p.mode === "workspace"}
        title={p.wsName}
        onClick={() => p.setMode("workspace")}
      >
        {p.wsName}
      </button>
    </div>
  );
}
