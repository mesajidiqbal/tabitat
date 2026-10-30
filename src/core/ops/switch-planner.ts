/**
 * Pure workspace-switch planner (ARCHITECTURE §5.3). Produces the durable SwitchOp, the
 * outgoing snapshot (I2: persisted before anything closes) and the opening plan.
 */
import type { SavedTab, SavedTabId, SwitchOp, SwitchStage, WorkspaceId } from "../model/types";
import { LIMITS } from "../model/types";
import { snapshotWindowDetailed } from "./snapshot";
import type { CreateSpec, GroupSpec, OpeningPlan, SwitchPlan, SwitchPlannerInput } from "./types";
import { buildPlaceholderUrl, captureUrl, classifyUrl, isBlankPageUrl, unwrapUrl } from "./url";

export type PlanErrorCode = "same_workspace";

/** Thrown by planSwitch for requests that must not produce an op. */
export class PlanError extends Error {
  override readonly name = "PlanError";
  constructor(readonly code: PlanErrorCode) {
    super(code === "same_workspace" ? "cannot switch a window to its current workspace" : code);
  }
}

/**
 * SwitchPlan plus the tabs a switch leaves alone. Declared here because ops/types.ts is a fixed
 * contract; it is a structural superset of SwitchPlan.
 */
export interface SwitchPlanWithRetained extends SwitchPlan {
  /**
   * Non-pinned tabs whose (unwrapped) URL classifies as "skip" (other extensions' pages,
   * devtools://, javascript:, data:, blob:, …). They cannot be saved or restored, so — like
   * pinned tabs — they stay open in the window across switches: never snapshotted, never closed.
   */
  retainedTabIds: number[];
}

/** savedTabId of the blank tab created when the target has nothing restorable (invariant I1). */
export const BLANK_SAVED_TAB_ID = "__blank__";
export const BLANK_TAB_URL = "about:blank";
/** A resumed op that has already been attempted this many times is abandoned (crash-loop guard). */
export const MAX_SWITCH_ATTEMPTS = 3;

export interface OpeningOptions {
  workspaceId: WorkspaceId;
  activeSavedTabId?: SavedTabId;
  /** Number of pinned tabs in the window; created tabs are placed after them. */
  pinnedCount: number;
  restoreLimit: number;
  placeholderBase: string;
  chunkSize?: number;
  /** Internal schemes the running browser can open directly (default chrome:/about:). */
  directSchemes?: readonly string[];
  /** Our extension origin: our own pages are created directly (ClassifyOptions.ownOrigin). */
  ownOrigin?: string;
}

function cloneTab(t: SavedTab): SavedTab {
  const c: SavedTab = { ...t };
  if (t.group) c.group = { ...t.group };
  return c;
}

/**
 * Opening plan for `incoming` (any order; sorted by saved index). Tabs with a "skip" URL and tabs
 * beyond `restoreLimit` go to `skipped`. Always yields at least one CreateSpec (I1).
 */
export function planOpening(incoming: readonly SavedTab[], opts: OpeningOptions): OpeningPlan {
  const ordered = [...incoming].sort((a, b) => a.index - b.index);
  const limit = Math.max(0, Math.floor(opts.restoreLimit));
  const restorable: Array<{ tab: SavedTab; mode: "placeholder" | "direct" }> = [];
  const skipped: SavedTab[] = [];
  for (const tab of ordered) {
    const mode = classifyUrl(tab.url, {
      directSchemes: opts.directSchemes,
      ownOrigin: opts.ownOrigin,
    });
    if (mode === "skip" || restorable.length >= limit) skipped.push(cloneTab(tab));
    else restorable.push({ tab, mode });
  }

  const activeId = restorable.some((r) => r.tab.id === opts.activeSavedTabId)
    ? opts.activeSavedTabId
    : restorable[0]?.tab.id;

  const specs: CreateSpec[] = restorable.map(({ tab, mode }, i) => ({
    savedTabId: tab.id,
    url:
      mode === "placeholder"
        ? buildPlaceholderUrl(opts.placeholderBase, {
            u: tab.url,
            t: tab.title,
            w: opts.workspaceId,
            s: tab.id,
          })
        : tab.url,
    mode,
    index: opts.pinnedCount + i,
    active: tab.id === activeId,
  }));
  if (specs.length === 0) {
    specs.push({
      savedTabId: BLANK_SAVED_TAB_ID,
      url: BLANK_TAB_URL,
      mode: "direct",
      index: opts.pinnedCount,
      active: true,
    });
  }

  const groups: GroupSpec[] = [];
  let current: GroupSpec | null = null;
  let currentGroupId: string | null = null;
  for (const { tab } of restorable) {
    const g = tab.group;
    if (!g) {
      current = null;
      currentGroupId = null;
      continue;
    }
    if (current && currentGroupId === g.id) {
      current.savedTabIds.push(tab.id);
      continue;
    }
    current = { savedTabIds: [tab.id], title: g.title, color: g.color, collapsed: g.collapsed };
    currentGroupId = g.id;
    groups.push(current);
  }

  const size = Math.max(1, opts.chunkSize ?? LIMITS.restoreChunk);
  const chunks: CreateSpec[][] = [];
  for (let i = 0; i < specs.length; i += size) chunks.push(specs.slice(i, i + size));
  return { chunks, groups, skipped };
}

/**
 * Builds the SwitchOp (stage "snapshot"), the outgoing snapshot and the opening plan.
 * Pinned tabs and unrestorable ("skip") tabs stay in the window: they are not in
 * `op.outgoingTabIds` (so the closing stage never removes them) and the latter are reported in
 * `retainedTabIds`. Throws PlanError("same_workspace") when `from === to`.
 */
export function planSwitch(input: SwitchPlannerInput): SwitchPlanWithRetained {
  if (input.from !== null && input.from === input.to) throw new PlanError("same_workspace");
  const { window } = input;
  const nonPinned = window.tabs.filter((t) => !t.pinned).sort((a, b) => a.index - b.index);
  const pinnedCount = window.tabs.length - nonPinned.length;
  const classify = { directSchemes: input.directSchemes, ownOrigin: input.ownOrigin };
  // Blank/new-tab pages are never retained (always closed on switch, never saved), even when
  // their scheme is foreign to this browser (e.g. edge://newtab on Chrome).
  const isRetained = (t: (typeof nonPinned)[number]) => {
    const real = unwrapUrl(captureUrl(t), input.placeholderBase);
    return !isBlankPageUrl(real) && classifyUrl(real, classify) === "skip";
  };
  const outgoing = nonPinned.filter((t) => !isRetained(t));
  const retainedTabIds = nonPinned.filter((t) => isRetained(t)).map((t) => t.id);

  const detail =
    input.from === null && outgoing.length === 0
      ? null
      : snapshotWindowDetailed(window, input.fromTabs, {
          placeholderBase: input.placeholderBase,
          now: input.now,
          newId: input.newId,
          directSchemes: input.directSchemes,
          ...(input.ownOrigin ? { ownOrigin: input.ownOrigin } : {}),
        });
  const outgoingSnapshot = detail?.snapshot ?? null;
  const outgoingSavedIds: Record<number, string> = {};
  for (const t of outgoing) {
    const sid = detail?.savedIdByTabId.get(t.id);
    if (sid !== undefined) outgoingSavedIds[t.id] = sid;
  }

  const incoming = [...input.toTabs.tabs].sort((a, b) => a.index - b.index).map(cloneTab);
  // Always creates at least one tab (blank if nothing is restorable), even when pinned or
  // retained tabs would already keep the window non-empty (I1) — simpler for the engine.
  const opening = planOpening(incoming, {
    workspaceId: input.to,
    activeSavedTabId: input.toTabs.activeSavedTabId,
    pinnedCount,
    restoreLimit: input.restoreLimit,
    placeholderBase: input.placeholderBase,
    directSchemes: input.directSchemes,
    ...(input.ownOrigin ? { ownOrigin: input.ownOrigin } : {}),
  });
  const active = opening.chunks.flat().find((s) => s.active);

  const op: SwitchOp = {
    id: input.newId(),
    windowId: window.id,
    from: input.from,
    to: input.to,
    stage: "snapshot",
    sessionEpoch: input.sessionEpoch,
    outgoingTabIds: outgoing.map((t) => t.id),
    outgoingSavedIds,
    createdTabIds: {},
    incoming,
    skipped: opening.skipped.map(cloneTab),
    startedAt: input.now,
    attempts: 0,
  };
  if (active) op.activeSavedTabId = active.savedTabId;
  return { op, outgoingSnapshot, opening, retainedTabIds };
}

const STAGE_ORDER: readonly SwitchStage[] = [
  "snapshot",
  "opening",
  "activating",
  "closing",
  "done",
];

/** The stage after `op.stage` ("done" stays "done"). */
export function nextStage(op: Pick<SwitchOp, "stage">): SwitchStage {
  const i = STAGE_ORDER.indexOf(op.stage);
  return STAGE_ORDER[Math.min(i + 1, STAGE_ORDER.length - 1)] as SwitchStage;
}

/**
 * Whether a persisted op can be resumed after a worker restart.
 * - abandon when the browser session changed (epoch) or attempts >= MAX_SWITCH_ATTEMPTS;
 * - opening/activating/closing: every created tab must still exist;
 * - opening/activating: every outgoing tab must still exist (we have not touched them yet);
 *   in "closing" some outgoing tabs may already be gone (that is the stage's own work).
 */
export function canResume(
  op: SwitchOp,
  liveTabIdsInWindow: ReadonlySet<number>,
  currentEpoch: string,
): "resume" | "abandon" {
  if (op.sessionEpoch !== currentEpoch) return "abandon";
  if (op.attempts >= MAX_SWITCH_ATTEMPTS) return "abandon";
  const allExist = (ids: Iterable<number>) => {
    for (const id of ids) if (!liveTabIdsInWindow.has(id)) return false;
    return true;
  };
  switch (op.stage) {
    case "snapshot":
    case "done":
      return "resume";
    case "opening":
    case "activating":
      return allExist(Object.values(op.createdTabIds)) && allExist(op.outgoingTabIds)
        ? "resume"
        : "abandon";
    case "closing":
      return allExist(Object.values(op.createdTabIds)) ? "resume" : "abandon";
  }
}
