/** Section registry: ids are the URL hashes (`options.html#suspension`). */
import type { ComponentType } from "preact";
import type { MsgKey } from "@/i18n";
import { AboutSection } from "./AboutSection";
import { BookmarksSection } from "./BookmarksSection";
import { DataSection } from "./DataSection";
import { GeneralSection } from "./GeneralSection";
import { PomodoroSection } from "./PomodoroSection";
import { SessionsSection } from "./SessionsSection";
import { ShortcutsSection } from "./ShortcutsSection";
import { SuspensionSection } from "./SuspensionSection";
import { SyncSection } from "./SyncSection";

export interface SectionDef {
  id: string;
  label: MsgKey;
  Component: ComponentType;
}

export const SECTIONS: readonly SectionDef[] = [
  { id: "general", label: "optGeneral", Component: GeneralSection },
  { id: "suspension", label: "optSuspension", Component: SuspensionSection },
  { id: "sessions", label: "optSessions", Component: SessionsSection },
  { id: "pomodoro", label: "optPomodoro", Component: PomodoroSection },
  { id: "sync", label: "optSync", Component: SyncSection },
  { id: "shortcuts", label: "optShortcuts", Component: ShortcutsSection },
  { id: "bookmarks", label: "optBookmarks", Component: BookmarksSection },
  { id: "data", label: "optData", Component: DataSection },
  { id: "about", label: "optAbout", Component: AboutSection },
];

/** The section named by a location hash ("#suspension"); unknown or empty falls back to General. */
export function sectionFromHash(hash: string): SectionDef {
  const id = hash.replace(/^#/, "");
  return SECTIONS.find((s) => s.id === id) ?? (SECTIONS[0] as SectionDef);
}
