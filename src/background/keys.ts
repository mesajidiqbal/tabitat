/** Storage keys owned by the background layer (not part of core's Keys contract). */
import * as v from "valibot";
import type { SavedTab, SwitchStage, WorkspaceId, WorkspaceTabs } from "../core/model/types";
import type { LiveGroup, LiveTab } from "../core/ops/types";

export const BgKeys = {
  /** Abandoned switch ops waiting for the recovery screen (storage.local). */
  recoveryPending: "recovery:pending",
  /** Quarantined record that failed validation (storage.local). */
  corrupt: (key: string) => `corrupt:${key}` as const,
  /**
   * Last-known tabs + groups of a window (storage.session), updated on every tab/group event, so
   * a window that closes before its debounced snapshot (it can no longer be queried) is still
   * saved with its newest contents. Also the source for recently-closed entries.
   */
  lk: (windowId: number) => `lk:${windowId}` as const,
  /**
   * Tab ids a switch closed (or deduplicated) in a window (storage.session), written before the
   * removals so a worker restart mid-switch does not misread them as user closures.
   */
  switchClosed: (windowId: number) => `switchClosed:${windowId}` as const,
  /** A staged import that could not be applied twice (storage.local; kept for recovery). */
  importFailed: "import:failed",
} as const;

export const BG_PREFIX = {
  corrupt: "corrupt:",
  lk: "lk:",
  migration: "migration:",
} as const;

/** Value of BgKeys.lk(windowId). */
export interface LastKnownWindow {
  tabs: LiveTab[];
  groups: LiveGroup[];
}

/** Value of BgKeys.switchClosed(windowId). */
export interface SwitchClosed {
  ids: number[];
  at: number;
}

export interface RecoveryEntry {
  opId: string;
  windowId: number;
  from: WorkspaceId | null;
  to: WorkspaceId;
  stage: SwitchStage;
  /** Frozen copy of the target tabs (op.incoming). */
  incoming: SavedTab[];
  /** Copy of the outgoing workspace's saved snapshot at abandon time. */
  fromSnapshot: WorkspaceTabs | null;
  reason: string;
  abandonedAt: number;
}

export interface RecoveryPending {
  entries: RecoveryEntry[];
}

const LooseTab = v.looseObject({ id: v.string(), url: v.string(), title: v.string() });

export const RecoveryPendingSchema = v.object({
  entries: v.array(
    v.object({
      opId: v.string(),
      windowId: v.number(),
      from: v.nullable(v.string()),
      to: v.string(),
      stage: v.picklist(["snapshot", "opening", "activating", "closing", "done"]),
      incoming: v.array(LooseTab),
      fromSnapshot: v.nullable(v.looseObject({ tabs: v.array(LooseTab) })),
      reason: v.string(),
      abandonedAt: v.number(),
    }),
  ),
});

export function parseRecoveryPending(input: unknown): RecoveryPending {
  return v.parse(RecoveryPendingSchema, input) as unknown as RecoveryPending;
}

export interface LastKnownTab {
  url: string;
  title: string;
  favIconUrl?: string;
}
