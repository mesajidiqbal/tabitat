/**
 * Roving tabindex for the rows of a grid (the primary cell of each row, or a group header's
 * button) and for listbox options (UI-SPEC Accessibility): one node is tabbable, arrows move
 * focus, Home/End jump. Keys pressed on inner controls are ignored; other cells of a row (the
 * actions cell) move between rows through `nav`. When the focused node disappears (e.g. its tab
 * closed or was replaced), focus moves to the node now at its place.
 */
import { useEffect, useRef, useState } from "preact/hooks";

export interface RovingItem {
  tabIndex: number;
  ref: (el: HTMLElement | null) => void;
  onFocus: () => void;
  onKeyDown: (e: KeyboardEvent) => void;
  /** Runs the row navigation of `key` from this node (ArrowUp/Down, Home/End); false: not one. */
  nav: (key: string) => boolean;
}

export interface RovingOptions {
  /** ArrowUp on the first option (e.g. back to the search box). */
  onExitTop?: () => void;
}

export type RovingAction = { kind: "focus"; index: number } | { kind: "exitTop" } | null;

/** What a key on node `index` of `count` nodes does (null: not a navigation key). Pure. */
export function rovingAction(
  key: string,
  index: number,
  count: number,
  hasExitTop: boolean,
): RovingAction {
  if (count <= 0) return null;
  const at = (i: number): RovingAction => ({
    kind: "focus",
    index: Math.max(0, Math.min(count - 1, i)),
  });
  switch (key) {
    case "ArrowDown":
      return at(index + 1);
    case "ArrowUp":
      return index === 0 && hasExitTop ? { kind: "exitTop" } : at(index - 1);
    case "Home":
      return at(0);
    case "End":
      return at(count - 1);
    default:
      return null;
  }
}

export function useRoving(count: number, opts: RovingOptions = {}) {
  const [active, setActive] = useState(0);
  const els = useRef<Array<HTMLElement | null>>([]);
  /** The node that last received focus (to notice it being removed). */
  const focused = useRef<HTMLElement | null>(null);
  const cur = count === 0 ? -1 : Math.min(active, count - 1);

  const focusAt = (i: number) => {
    if (count === 0) return;
    const n = Math.max(0, Math.min(count - 1, i));
    setActive(n);
    els.current[n]?.focus();
  };

  // The focused node left the DOM and took focus with it: the list shrank under it (a tab closed)
  // or it was replaced in place (a discarded tab gets a new id, so its row remounts). Focus the
  // node now at its index once the DOM has settled. Runs after every render; a pending retry is
  // rescheduled by the next render until a node takes focus again.
  useEffect(() => {
    if (count === 0) return;
    const gone = focused.current !== null && !focused.current.isConnected;
    const ae = document.activeElement;
    const lost = ae === null || ae === document.body || !ae.isConnected;
    if (!gone || !lost) return;
    const id = setTimeout(() => focusAt(cur));
    return () => clearTimeout(id);
  });

  const nav = (i: number, key: string): boolean => {
    const action = rovingAction(key, i, count, opts.onExitTop !== undefined);
    if (action === null) return false;
    if (action.kind === "exitTop") opts.onExitTop?.();
    else focusAt(action.index);
    return true;
  };

  const item = (i: number): RovingItem => ({
    tabIndex: i === cur ? 0 : -1,
    ref: (el) => {
      els.current[i] = el;
    },
    onFocus: () => {
      setActive(i);
      focused.current = els.current[i] ?? null;
    },
    onKeyDown: (e) => {
      if (e.target !== e.currentTarget || e.altKey || e.ctrlKey || e.metaKey) return;
      if (nav(i, e.key)) e.preventDefault();
    },
    nav: (key) => nav(i, key),
  });

  return { item, focusAt, active: cur };
}

/**
 * Focuses the tabbable node of a list by element id (e.g. from the search box): the primary cell
 * (or group header button) of a grid row, or a listbox option.
 */
export function focusList(id: string): boolean {
  const el = document
    .getElementById(id)
    ?.querySelector<HTMLElement>(
      '[role="row"] [tabindex="0"], [role="option"][tabindex="0"], button[tabindex="0"]',
    );
  el?.focus();
  return !!el;
}
