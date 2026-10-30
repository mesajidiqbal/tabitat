/**
 * Roving tabindex for listbox options (UI-SPEC Accessibility): one option is tabbable, arrows
 * move focus, Home/End jump. Keys pressed on inner controls are ignored.
 */
import { useRef, useState } from "preact/hooks";

export interface RovingItem {
  tabIndex: number;
  ref: (el: HTMLElement | null) => void;
  onFocus: () => void;
  onKeyDown: (e: KeyboardEvent) => void;
}

export interface RovingOptions {
  /** ArrowUp on the first option (e.g. back to the search box). */
  onExitTop?: () => void;
}

export function useRoving(count: number, opts: RovingOptions = {}) {
  const [active, setActive] = useState(0);
  const els = useRef<Array<HTMLElement | null>>([]);
  const cur = count === 0 ? -1 : Math.min(active, count - 1);

  const focusAt = (i: number) => {
    if (count === 0) return;
    const n = Math.max(0, Math.min(count - 1, i));
    setActive(n);
    els.current[n]?.focus();
  };

  const item = (i: number): RovingItem => ({
    tabIndex: i === cur ? 0 : -1,
    ref: (el) => {
      els.current[i] = el;
    },
    onFocus: () => setActive(i),
    onKeyDown: (e) => {
      if (e.target !== e.currentTarget || e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === "ArrowDown") focusAt(i + 1);
      else if (e.key === "ArrowUp") {
        if (i === 0 && opts.onExitTop) opts.onExitTop();
        else focusAt(i - 1);
      } else if (e.key === "Home") focusAt(0);
      else if (e.key === "End") focusAt(count - 1);
      else return;
      e.preventDefault();
    },
  });

  return { item, focusAt, active: cur };
}

/** Focuses the tabbable option of a listbox by element id (e.g. from the search box). */
export function focusList(id: string): boolean {
  const el = document
    .getElementById(id)
    ?.querySelector<HTMLElement>('[role="option"][tabindex="0"]');
  el?.focus();
  return !!el;
}
