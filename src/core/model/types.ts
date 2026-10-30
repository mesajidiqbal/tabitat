/**
 * Canonical record types persisted in chrome.storage.local.
 * This file is the contract between core/, background/ and ui/.
 * Pure: no chrome.* imports. See docs/ARCHITECTURE.md §6.
 */

export type WorkspaceId = string;
export type SavedTabId = string;
export type Scope = "global" | WorkspaceId;

/** Chrome tab-group colours; used for both groups and workspaces. */
export type Color =
  | "grey"
  | "blue"
  | "red"
  | "yellow"
  | "green"
  | "pink"
  | "purple"
  | "cyan"
  | "orange";

export interface SavedTabGroup {
  /** Stable id (ours), not the Chrome group id. */
  id: string;
  title: string;
  color: Color;
  collapsed: boolean;
}

/** A tab as stored in a workspace snapshot. Pinned tabs are never saved (they belong to the window). */
export interface SavedTab {
  id: SavedTabId;
  /** Always the real target URL — never a suspended.html placeholder URL. */
  url: string;
  title: string;
  index: number;
  favIconUrl?: string;
  group?: SavedTabGroup;
}

export interface SavedLink {
  id: string;
  url: string;
  title: string;
  order: number;
  addedAt: number;
}

export interface WorkspaceMeta {
  id: WorkspaceId;
  name: string;
  color: Color;
  emoji?: string;
  /** "unsorted" = implicit per-window workspace for untracked tabs. */
  kind: "named" | "unsorted";
  /** Last window this workspace was open in (hint only; ids change per browser session). */
  windowHint?: number;
  resources: SavedLink[];
  createdAt: number;
  updatedAt: number;
  rev: number;
}

export interface WorkspaceTabs {
  tabs: SavedTab[];
  activeSavedTabId?: SavedTabId;
  updatedAt: number;
  rev: number;
}

export interface WindowState {
  activeWorkspaceId: WorkspaceId | null;
  /**
   * Random id stored in storage.session. A missing value means "worker context reset" (browser
   * restart, extension reload/update/disable): window ids are then verified against the live
   * windows, never trusted on the epoch alone.
   */
  sessionEpoch: string;
  /**
   * Set by startup reconciliation when the window was matched to its workspace heuristically
   * (placeholder hint or URL similarity). While set, the workspace's pre-reconciliation tabs are
   * kept under `ws:prev:<id>`. Cleared by the first user-initiated switch or after
   * PROVISIONAL_MS of tracking.
   */
  provisional?: boolean;
  /** When `provisional` was set (ms epoch). */
  provisionalAt?: number;
}

export type SwitchStage = "snapshot" | "opening" | "activating" | "closing" | "done";

/** Durable per-window switch operation record (storage.local `op:switch:<windowId>`). */
export interface SwitchOp {
  id: string;
  windowId: number;
  from: WorkspaceId | null;
  to: WorkspaceId;
  stage: SwitchStage;
  sessionEpoch: string;
  /** Real tab ids of the outgoing (non-pinned) tabs captured at snapshot. */
  outgoingTabIds: number[];
  /**
   * Outgoing tab id -> id of the SavedTab it was saved as in `ws:tabs:<from>`. Used by the
   * closing stage to revalidate each tab against its saved entry before removing it.
   * Absent for ops written before this field existed (and for blank tabs, which are not saved).
   */
  outgoingSavedIds?: Record<number, string>;
  /** Map savedTabId -> created tab id, filled during "opening". */
  createdTabIds: Record<SavedTabId, number>;
  /** Frozen copy of the target tabs at op start. */
  incoming: SavedTab[];
  activeSavedTabId?: SavedTabId;
  /** Tabs that could not be restored (unsupported scheme etc.). */
  skipped: SavedTab[];
  startedAt: number;
  attempts: number;
}

export interface SessionWindow {
  windowId: number;
  workspaceId: WorkspaceId | null;
  tabs: SavedTab[];
}

export interface SessionGeneration {
  id: number;
  takenAt: number;
  windows: SessionWindow[];
}

export interface ClosedTab {
  id: string;
  url: string;
  title: string;
  favIconUrl?: string;
  closedAt: number;
  workspaceId?: WorkspaceId;
}

export interface Todo {
  id: string;
  text: string;
  done: boolean;
  order: number;
  createdAt: number;
  doneAt?: number;
}
export interface TodoList {
  items: Todo[];
  rev: number;
}

export interface Note {
  content: string;
  updatedAt: number;
  rev: number;
}

export interface QuickLink {
  id: string;
  url: string;
  title: string;
  order: number;
}
export interface QuickLinks {
  items: QuickLink[];
  rev: number;
}

export type TrashItem =
  | { id: string; kind: "workspace"; deletedAt: number; meta: WorkspaceMeta; tabs: WorkspaceTabs }
  | { id: string; kind: "link"; deletedAt: number; workspaceId: WorkspaceId; link: SavedLink };
export interface Trash {
  items: TrashItem[];
}

export type WidgetId =
  | "clock"
  | "search"
  | "quicklinks"
  | "workspaces"
  | "todos"
  | "notes"
  | "pomodoro";

export interface Settings {
  theme: "system" | "light" | "dark";
  dashboard: {
    widgets: WidgetId[];
    wallpaper: { kind: "color" | "gradient" | "image"; value: string };
  };
  suspend: { enabled: boolean; afterMinutes: number; whitelist: string[] };
  sessions: { everyMinutes: number; keep: number };
  pomodoro: { workMin: number; breakMin: number; longBreakMin: number; roundsBeforeLong: number };
  syncSettings: boolean;
  /** Max tabs restored by one switch; the rest are listed as skipped. */
  restoreLimit: number;
  rev: number;
}

export type PomodoroPhase = "work" | "break" | "longBreak";
export interface PomodoroState {
  phase: PomodoroPhase;
  endsAt: number;
  round: number;
}

export type Flavor = "default" | "newtab";

export interface Meta {
  schemaVersion: number;
  installedAt: number;
  flavor: Flavor;
}

/** Export/import file format. */
export interface BackupFile {
  format: "tabitat-backup";
  version: 1;
  exportedAt: number;
  data: {
    settings: Settings;
    workspaces: Array<{ meta: WorkspaceMeta; tabs: WorkspaceTabs }>;
    todos: Record<Scope, TodoList>;
    notes: Record<Scope, Note>;
    quicklinks: QuickLinks;
  };
}

export const SCHEMA_VERSION = 1;

/** Storage key builders. Keep every key here so onChanged filters and tests share one source. */
export const Keys = {
  meta: "meta",
  settings: "settings",
  wsIndex: "ws:index",
  wsMeta: (id: WorkspaceId) => `ws:meta:${id}` as const,
  wsTabs: (id: WorkspaceId) => `ws:tabs:${id}` as const,
  /** One-deep previous version of ws:tabs:<id>, kept while a window's match is provisional. */
  wsPrev: (id: WorkspaceId) => `ws:prev:${id}` as const,
  window: (windowId: number) => `windows:${windowId}` as const,
  opSwitch: (windowId: number) => `op:switch:${windowId}` as const,
  dirty: (windowId: number) => `dirty:${windowId}` as const,
  sessionsIndex: "sessions:index",
  sessionGen: (n: number) => `sessions:gen:${n}` as const,
  recentlyClosed: "recentlyClosed",
  todos: (scope: Scope) => `todos:${scope}` as const,
  notes: (scope: Scope) => `notes:${scope}` as const,
  quicklinks: "quicklinks",
  trash: "trash",
  pomodoro: "pomodoro",
  migration: (n: number) => `migration:${n}` as const,
  importStaging: "import:staging",
  epoch: "epoch",
} as const;

export const KEY_PREFIX = {
  wsMeta: "ws:meta:",
  wsTabs: "ws:tabs:",
  wsPrev: "ws:prev:",
  window: "windows:",
  opSwitch: "op:switch:",
  dirty: "dirty:",
  sessionGen: "sessions:gen:",
  todos: "todos:",
  notes: "notes:",
} as const;

export const LIMITS = {
  recentlyClosed: 50,
  sessionGenerations: 10,
  trashRetentionMs: 30 * 24 * 60 * 60 * 1000,
  restoreChunk: 10,
} as const;

/** How long a heuristically reconciled window stays provisional (WindowState.provisional). */
export const PROVISIONAL_MS = 10 * 60 * 1000;

/** `ws:prev:<id>`: the workspace's saved tabs as they were when a provisional match was made. */
export interface WorkspacePrev {
  tabs: WorkspaceTabs;
  savedAt: number;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: "system",
  dashboard: {
    widgets: ["clock", "search", "quicklinks", "workspaces", "todos"],
    wallpaper: { kind: "gradient", value: "aurora" },
  },
  suspend: { enabled: false, afterMinutes: 30, whitelist: [] },
  sessions: { everyMinutes: 5, keep: 10 },
  pomodoro: { workMin: 25, breakMin: 5, longBreakMin: 15, roundsBeforeLong: 4 },
  syncSettings: false,
  restoreLimit: 100,
  rev: 0,
};
