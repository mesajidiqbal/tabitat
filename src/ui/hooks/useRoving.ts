/**
 * Roving tabindex for the rows of a grid (the primary cell of each row, or a group header's
 * button) and for listbox options (UI-SPEC Accessibility): one node is tabbable, arrows move
 * focus, Home/End jump. Keys pressed on inner controls are ignored; other cells of a row (the
 * actions cell) move between rows through `nav`. When the focused node disappears (e.g. its tab
 * closed or was replaced), focus moves to the node now at its place; when the list became empty,
 * `onEmpty` puts it somewhere sensible (the section heading, the search box). A list laid out as
 * cards in several columns passes `columns`: Up/Down then move by a visual row, Left/Right by
 * one card.
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
  /** ArrowUp on the first option (on the first visual row with `columns`), e.g. the search box. */
  onExitTop?: () => void;
  /** The focused node left with the last one of the list: focus something else (C2.3). */
  onEmpty?: () => void;
  /** Cards per visual row, read at keydown time: two-dimensional arrows (C3.3). */
  columns?: () => number;
}

export type RovingAction = { kind: "focus"; index: number } | { kind: "exitTop" } | null;

/**
 * What a key on node `index` of `count` nodes does (null: not a navigation key). Pure. Without
 * `cols` the list is one column (Left/Right are not navigation keys). With `cols` (cards laid out
 * `cols` per row) Up/Down move by a row without wrapping (Down from the row above a shorter last
 * row lands on the last card; Up on the first row exits the top when there is an exit, else
 * stays) and Left/Right move by one card.
 */
export function rovingAction(
  key: string,
  index: number,
  count: number,
  hasExitTop: boolean,
  cols?: number,
): RovingAction {
  if (count <= 0) return null;
  const clamp = (i: number) => Math.max(0, Math.min(count - 1, i));
  const at = (i: number): RovingAction => ({ kind: "focus", index: clamp(i) });
  if (cols !== undefined) {
    const c = Math.max(1, Math.floor(cols));
    const i = clamp(index);
    const row = (n: number) => Math.floor(n / c);
    switch (key) {
      case "ArrowRight":
        return at(i + 1);
      case "ArrowLeft":
        return at(i - 1);
      case "ArrowDown":
        if (i + c <= count - 1) return at(i + c);
        return at(row(i) < row(count - 1) ? count - 1 : i);
      case "ArrowUp":
        if (i - c >= 0) return at(i - c);
        return hasExitTop ? { kind: "exitTop" } : at(i);
    }
  }
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

/** Cards per visual row of a grid: the rows sharing the first row's `offsetTop` (at least 1). */
export function gridColumns(grid: Element | null): number {
  const rows = grid ? [...grid.querySelectorAll<HTMLElement>(':scope > [role="row"]')] : [];
  const top = rows[0]?.offsetTop;
  let n = 0;
  while (n < rows.length && rows[n]?.offsetTop === top) n++;
  return Math.max(1, n);
}

/**
 * For `onEmpty`: focuses the first element among `ids` that exists (for a heading, its
 * disclosure button when it has one; headings carry `tabIndex={-1}`). False when none took focus.
 */
export function focusFirst(...ids: string[]): boolean {
  for (const id of ids) {
    const el = document.getElementById(id);
    if (!el) continue;
    const target = /^H[1-6]$/.test(el.tagName)
      ? (el.querySelector<HTMLElement>("button") ?? el)
      : el;
    target.focus();
    if (document.activeElement === target) return true;
  }
  return false;
}

export function useRoving(count: number, opts: RovingOptions = {}) {
  const [active, setActive] = useState(0);
  const els = useRef<Array<HTMLElement | null>>([]);
  /** The node that last received focus (to notice it being removed). */
  const focused = useRef<HTMLElement | null>(null);
  const cur = count === 0 ? -1 : Math.min(active, count - 1);
  const o = useRef(opts);
  o.current = opts;

  const focusAt = (i: number) => {
    if (count === 0) return;
    const n = Math.max(0, Math.min(count - 1, i));
    setActive(n);
    els.current[n]?.focus();
  };

  // The focused node left the DOM and took focus with it: the list shrank under it (a tab closed)
  // or it was replaced in place (a discarded tab gets a new id, so its row remounts). Focus the
  // node now at its index once the DOM has settled; when the list is now empty, `onEmpty` picks
  // the target (C2.3). Runs after every render; a pending retry is rescheduled by the next render
  // until something takes focus again.
  useEffect(() => {
    const gone = focused.current !== null && !focused.current.isConnected;
    const ae = document.activeElement;
    const lost = ae === null || ae === document.body || !ae.isConnected;
    if (!gone || !lost) return;
    if (count === 0) {
      if (!o.current.onEmpty) return;
      const id = setTimeout(() => {
        focused.current = null;
        o.current.onEmpty?.();
      });
      return () => clearTimeout(id);
    }
    const id = setTimeout(() => focusAt(cur));
    return () => clearTimeout(id);
  });

  const nav = (i: number, key: string): boolean => {
    const action = rovingAction(key, i, count, opts.onExitTop !== undefined, opts.columns?.());
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
