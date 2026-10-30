/**
 * Search + keyboard map shared by popup and side panel (UI-SPEC):
 *   /  focus search · 1–9 switch to the nth workspace (search empty) · n new workspace ·
 *   s open side panel (popup) · ↑↓ results / lists · Enter open · Esc clear, then close (popup).
 * Single-letter shortcuts apply when focus is not in a text field; digits also work in the
 * empty search box (the popup focuses it on open).
 */
import { useEffect, useRef, useState } from "preact/hooks";
import { t } from "@/i18n";
import { closePopup, newWorkspaceOpen, openSidePanel, switchTo, uiError } from "../actions";
import { openHit, search } from "../search";
import { WS_LIST_ID } from "../sections/WorkspacesSection";
import { busy, workspaces } from "../store";
import { focusList } from "./useRoving";

const editable = (el: EventTarget | null) =>
  el instanceof HTMLElement &&
  (el.isContentEditable ||
    el.tagName === "INPUT" ||
    el.tagName === "TEXTAREA" ||
    el.tagName === "SELECT");

export function switchNth(i: number): void {
  const m = workspaces.peek()[i];
  if (m) void switchTo(m.id);
}

/** The highlighted result: `selected` clamped to the current hits (0 when there are none). */
export const effectiveSelection = (selected: number, hitCount: number): number =>
  Math.max(0, Math.min(selected, hitCount - 1));

export function useSurface(variant: "popup" | "panel") {
  const [query, setQueryRaw] = useState("");
  const [selectedRaw, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const hits = search(query);
  // Hits can shrink under a stale selection (e.g. a tab closed): always use the clamped index.
  const selected = effectiveSelection(selectedRaw, hits.length);
  const setQuery = (q: string) => {
    setQueryRaw(q);
    setSelected(0);
  };
  const focusSearch = () => inputRef.current?.focus();
  const popup = variant === "popup";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || editable(e.target)) return;
      const k = e.key;
      if (k === "/") focusSearch();
      else if (k >= "1" && k <= "9") switchNth(Number(k) - 1);
      else if (k === "n") newWorkspaceOpen.value = true;
      else if (k === "s" && popup) openSidePanel();
      else if (k === "Escape" && newWorkspaceOpen.peek()) newWorkspaceOpen.value = false;
      else if (k === "Escape" && popup) closePopup();
      else return;
      e.preventDefault();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [popup]);

  const onSearchKeyDown = (e: KeyboardEvent) => {
    const k = e.key;
    const empty = query.trim() === "";
    if (k === "ArrowDown") {
      if (empty) focusList(WS_LIST_ID);
      else if (hits.length > 0) setSelected(effectiveSelection(selected + 1, hits.length));
    } else if (k === "ArrowUp" && !empty) {
      if (hits.length > 0) setSelected(effectiveSelection(selected - 1, hits.length));
    } else if (k === "Enter" && !empty) {
      const hit = hits[selected];
      // A switch is running: say so instead of silently ignoring the key (switchTo would no-op).
      if (hit?.kind === "workspace" && busy.peek()) uiError.value = { text: t("err_busy") };
      else if (hit) void openHit(hit);
    } else if (k === "Escape") {
      if (!empty) setQuery("");
      else if (popup) closePopup();
      else e.currentTarget instanceof HTMLElement && e.currentTarget.blur();
    } else if (
      empty &&
      k >= "1" &&
      k <= "9" &&
      k.length === 1 &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey
    ) {
      switchNth(Number(k) - 1);
    } else return;
    e.preventDefault();
    e.stopPropagation();
  };

  return { query, setQuery, hits, selected, setSelected, inputRef, focusSearch, onSearchKeyDown };
}
