/**
 * Side panel widget sections (docs/PHASE4.md §4): collapsible Todos, Notes and Pomodoro below
 * Recently closed, using the dashboard widgets' compact variant (code-split, loaded on expand).
 * Which sections are open is per-viewer UI state in localStorage (may be unavailable).
 */
import type { ComponentType } from "preact";
import { lazy, Suspense } from "preact/compat";
import { useState } from "preact/hooks";
import { type MsgKey, t } from "@/i18n";
import { SectionHeader } from "@/ui/components/SectionHeader";
import s from "@/ui/sections/sections.module.css";
import { Skeleton } from "@/ui/widgets/Card";

const STORAGE_KEY = "tabitat:sidepanel:open";
type Id = "todos" | "notes" | "pomodoro";

const SECTIONS: Array<{ id: Id; title: MsgKey; C: ComponentType<{ compact?: boolean }> }> = [
  {
    id: "todos",
    title: "dashTodos",
    C: lazy(() => import("@/ui/widgets").then((m) => ({ default: m.Todos }))),
  },
  {
    id: "notes",
    title: "dashNotes",
    C: lazy(() => import("@/ui/widgets").then((m) => ({ default: m.Notes }))),
  },
  {
    id: "pomodoro",
    title: "dashPomodoro",
    C: lazy(() => import("@/ui/widgets").then((m) => ({ default: m.Pomodoro }))),
  },
];

function readOpen(): Partial<Record<Id, boolean>> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    return typeof v === "object" && v !== null ? (v as Partial<Record<Id, boolean>>) : {};
  } catch {
    return {};
  }
}

function writeOpen(v: Partial<Record<Id, boolean>>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(v));
  } catch {
    // storage unavailable (private mode, blocked): the state just is not remembered
  }
}

export function PanelWidgets() {
  const [open, setOpen] = useState(readOpen);
  const toggle = (id: Id) => {
    const next = { ...open, [id]: !open[id] };
    setOpen(next);
    writeOpen(next);
  };
  return (
    <>
      {SECTIONS.map(({ id, title, C }) => (
        <section key={id} class={s.section} aria-labelledby={`pw-${id}-h`}>
          <SectionHeader
            id={`pw-${id}-h`}
            title={t(title)}
            sticky
            open={open[id] === true}
            onToggle={() => toggle(id)}
            controls={`pw-${id}`}
          />
          {open[id] === true && (
            <div id={`pw-${id}`}>
              <Suspense fallback={<Skeleton small />}>
                <C compact />
              </Suspense>
            </div>
          )}
        </section>
      ))}
    </>
  );
}
