/**
 * Unsaved note drafts by scope (docs/PHASE4.md §4 Notes; review C-B1). Module-level, so a draft
 * outlives the editor (scope switch, section collapse, widget toggled off), and mirrored to
 * sessionStorage (`tabitat:noteDraft:<scope>`, per-viewer state) so a reload restores it. A
 * conflicted draft keeps its flag: the "Changed elsewhere" notice comes back with it.
 */
import type { Scope } from "@/core/model/types";

export interface NoteDraft {
  content: string;
  /** The stored rev the draft was started from (expectedRev of note.set). */
  baseRev: number;
  /** A save hit a conflict: waits for Reload / Keep mine. */
  conflict: boolean;
}

const drafts = new Map<Scope, NoteDraft>();
const PREFIX = "tabitat:noteDraft:";

function parse(raw: string | null): NoteDraft | null {
  if (raw === null) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (typeof v !== "object" || v === null) return null;
    const { content, baseRev, conflict } = v as Record<string, unknown>;
    if (typeof content !== "string" || typeof conflict !== "boolean") return null;
    if (typeof baseRev !== "number" || !Number.isInteger(baseRev) || baseRev < 0) return null;
    return { content, baseRev, conflict };
  } catch {
    return null;
  }
}

/** The scope's draft (memory first, then sessionStorage); null when there is none. */
export function getNoteDraft(scope: Scope): NoteDraft | null {
  const mem = drafts.get(scope);
  if (mem) return mem;
  let restored: NoteDraft | null = null;
  try {
    restored = parse(sessionStorage.getItem(PREFIX + scope));
  } catch {
    // storage unavailable: memory only
  }
  if (restored) drafts.set(scope, restored);
  return restored;
}

/** Sets (or with null drops) the scope's draft, in memory and in sessionStorage. */
export function setNoteDraft(scope: Scope, draft: NoteDraft | null): void {
  if (draft) drafts.set(scope, draft);
  else drafts.delete(scope);
  try {
    if (draft) sessionStorage.setItem(PREFIX + scope, JSON.stringify(draft));
    else sessionStorage.removeItem(PREFIX + scope);
  } catch {
    // storage unavailable or full: the in-memory draft still survives unmounts
  }
}

/** Tests: forget every draft (`memoryOnly` keeps sessionStorage, like a page reload). */
export function resetNoteDrafts(memoryOnly = false): void {
  drafts.clear();
  if (memoryOnly) return;
  try {
    for (const k of Object.keys(sessionStorage))
      if (k.startsWith(PREFIX)) sessionStorage.removeItem(k);
  } catch {
    // ignore
  }
}
