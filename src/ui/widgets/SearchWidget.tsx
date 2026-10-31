/**
 * Dashboard search (docs/PHASE4.md §4): the popup's `search()` index with a results dropdown.
 * ↑↓ select, Enter opens the hit, or with no hit searches the web with the browser's default
 * engine in this tab (chrome.search.query; Shift+Enter always does). `/` focuses; Esc clears,
 * then leaves the box.
 */
import { useEffect, useRef, useState } from "preact/hooks";
import { t } from "@/i18n";
import { errorInfo, uiError } from "../actions";
import { ResultRow } from "../components/ResultRow";
import { SearchBox } from "../components/SearchBox";
import { openHit, search } from "../search";
import type { WidgetProps } from "./Card";
import s from "./widgets.module.css";

const LIST_ID = "dash-results";
const effectiveSelection = (i: number, n: number) => Math.max(0, Math.min(i, n - 1));
const hitId = (i: number) => `dash-hit-${i}`;

const editable = (el: EventTarget | null) =>
  el instanceof HTMLElement &&
  (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));

export function webSearch(text: string): void {
  chrome.search.query({ text, disposition: "CURRENT_TAB" }).catch((e: unknown) => {
    uiError.value = errorInfo(e);
  });
}

export function SearchWidget(_: WidgetProps) {
  const [query, setQueryRaw] = useState("");
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const hits = search(query, 12);
  const selected = effectiveSelection(sel, hits.length);
  const open = query.trim() !== "";
  const setQuery = (q: string) => {
    setQueryRaw(q);
    setSel(0);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      if (editable(e.target)) return;
      e.preventDefault();
      input.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const onKeyDown = (e: KeyboardEvent) => {
    // IME: keys that pick or confirm a composition belong to the IME, not the search (C-B8).
    if (e.isComposing) return;
    const k = e.key;
    if (k === "ArrowDown" && open) setSel(effectiveSelection(selected + 1, hits.length));
    else if (k === "ArrowUp" && open) setSel(effectiveSelection(selected - 1, hits.length));
    else if (k === "Enter" && open) {
      const hit = e.shiftKey ? undefined : hits[selected];
      if (hit) void openHit(hit);
      else webSearch(query.trim());
    } else if (k === "Escape") {
      if (open) setQuery("");
      else input.current?.blur();
    } else return;
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div class={s.search} data-widget="search">
      <div class={s.searchBox}>
        <SearchBox
          value={query}
          onInput={setQuery}
          onKeyDown={onKeyDown}
          inputRef={input}
          listId={LIST_ID}
          activeId={hits.length > 0 ? hitId(selected) : undefined}
        />
      </div>
      {open && (
        <div class={s.dropdown}>
          {hits.length > 0 && (
            <div id={LIST_ID} role="listbox" aria-label={t("searchResults")}>
              {hits.map((hit, i) => (
                <ResultRow
                  key={hit.key}
                  id={hitId(i)}
                  hit={hit}
                  selected={i === selected}
                  onHover={() => i !== selected && setSel(i)}
                  onOpen={() => void openHit(hit)}
                />
              ))}
            </div>
          )}
          <p class={s.webHint} role="status">
            {hits.length > 0 ? t("dashSearchHint") : t("dashSearchWeb", query.trim())}
          </p>
        </div>
      )}
    </div>
  );
}
