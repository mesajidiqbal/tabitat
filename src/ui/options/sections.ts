/**
 * Section registry: ids are the URL hashes (`options.html#suspension`). Each section is loaded on
 * demand (`lazy`), so the page ships only the section being shown; the shell wraps them in a
 * Suspense boundary.
 */
import type { ComponentType } from "preact";
import { lazy } from "preact/compat";
import type { MsgKey } from "@/i18n";

export interface SectionDef {
  id: string;
  label: MsgKey;
  Component: ComponentType;
}

export const SECTIONS: readonly SectionDef[] = [
  {
    id: "general",
    label: "optGeneral",
    Component: lazy(() => import("./GeneralSection").then((m) => m.GeneralSection)),
  },
  {
    id: "suspension",
    label: "optSuspension",
    Component: lazy(() => import("./SuspensionSection").then((m) => m.SuspensionSection)),
  },
  {
    id: "sessions",
    label: "optSessions",
    Component: lazy(() => import("./SessionsSection").then((m) => m.SessionsSection)),
  },
  {
    id: "pomodoro",
    label: "optPomodoro",
    Component: lazy(() => import("./PomodoroSection").then((m) => m.PomodoroSection)),
  },
  {
    id: "sync",
    label: "optSync",
    Component: lazy(() => import("./SyncSection").then((m) => m.SyncSection)),
  },
  {
    id: "shortcuts",
    label: "optShortcuts",
    Component: lazy(() => import("./ShortcutsSection").then((m) => m.ShortcutsSection)),
  },
  {
    id: "bookmarks",
    label: "optBookmarks",
    Component: lazy(() => import("./BookmarksSection").then((m) => m.BookmarksSection)),
  },
  {
    id: "data",
    label: "optData",
    Component: lazy(() => import("./DataSection").then((m) => m.DataSection)),
  },
  {
    id: "about",
    label: "optAbout",
    Component: lazy(() => import("./AboutSection").then((m) => m.AboutSection)),
  },
];

/** The section named by a location hash ("#suspension"); unknown or empty falls back to General. */
export function sectionFromHash(hash: string): SectionDef {
  const id = hash.replace(/^#/, "");
  return SECTIONS.find((s) => s.id === id) ?? (SECTIONS[0] as SectionDef);
}
