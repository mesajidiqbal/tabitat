/**
 * Pure planning types for browser operations. The planner in core/ turns a
 * live window + a target workspace into a SwitchOp and per-stage plans; the
 * WorkspaceEngine in background/ executes them through platform ports.
 */
import type {
  Color,
  SavedTab,
  SavedTabId,
  SwitchOp,
  WorkspaceId,
  WorkspaceTabs,
} from "../model/types";

/** Browser-agnostic view of a live tab (mapped from the browser Tab object by platform/). */
export interface LiveTab {
  id: number;
  windowId: number;
  url: string;
  title: string;
  index: number;
  pinned: boolean;
  active: boolean;
  /** -1 when not grouped. */
  groupId: number;
  favIconUrl?: string;
  discarded: boolean;
  audible: boolean;
  lastAccessed?: number;
}

export interface LiveGroup {
  id: number;
  title: string;
  color: Color;
  collapsed: boolean;
}

export interface LiveWindow {
  id: number;
  tabs: LiveTab[];
  groups: LiveGroup[];
}

/** How a saved URL is restored. */
export type RestoreMode = "placeholder" | "direct" | "skip";

export interface CreateSpec {
  savedTabId: SavedTabId;
  /** URL to pass to tabs.create: a placeholder URL, or the target for "direct". */
  url: string;
  mode: Exclude<RestoreMode, "skip">;
  index: number;
  active: boolean;
}

export interface GroupSpec {
  savedTabIds: SavedTabId[];
  title: string;
  color: Color;
  collapsed: boolean;
}

export interface OpeningPlan {
  /** Creation specs, in chunks of LIMITS.restoreChunk. */
  chunks: CreateSpec[][];
  groups: GroupSpec[];
  skipped: SavedTab[];
}

export interface SwitchPlannerInput {
  window: LiveWindow;
  from: WorkspaceId | null;
  to: WorkspaceId;
  /** Previous snapshot of `from` (for stable SavedTab ids), if any. */
  fromTabs: WorkspaceTabs | null;
  toTabs: WorkspaceTabs;
  sessionEpoch: string;
  now: number;
  restoreLimit: number;
  /** the runtime URL of suspended.html */
  placeholderBase: string;
  newId: () => string;
  /**
   * Browser-internal schemes that can be created directly in the running browser
   * (e.g. ["chrome:", "about:"] on Chrome, plus "edge:" on Edge, "brave:" on Brave).
   * Saved tabs with other internal schemes are reported as skipped. Defaults to chrome:/about:.
   */
  directSchemes?: string[];
}

export interface SwitchPlan {
  op: SwitchOp;
  /** Snapshot of the outgoing workspace to persist before closing anything (null when from is null and window is empty). */
  outgoingSnapshot: WorkspaceTabs | null;
  opening: OpeningPlan;
}

export interface PlaceholderParams {
  u: string;
  t: string;
  w: WorkspaceId;
  s: SavedTabId;
}
