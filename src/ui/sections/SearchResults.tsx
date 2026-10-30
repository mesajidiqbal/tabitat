/** Search results listbox (driven by the combobox: selection = aria-activedescendant). */
import { t } from "@/i18n";
import { EmptyState } from "../components/EmptyState";
import { ResultRow } from "../components/ResultRow";
import r from "../components/rows.module.css";
import { openHit, type UiHit } from "../search";
import s from "./sections.module.css";

export const RESULTS_ID = "search-results";
export const resultId = (i: number) => `hit-${i}`;

export function SearchResults(p: {
  hits: UiHit[];
  selected: number;
  onSelect: (i: number) => void;
}) {
  if (p.hits.length === 0) {
    return (
      <div id={RESULTS_ID} role="listbox" aria-label={t("searchResults")}>
        <EmptyState title={t("noResults")} hint={t("noResultsHint")} />
      </div>
    );
  }
  return (
    <section class={s.section}>
      <div id={RESULTS_ID} role="listbox" aria-label={t("searchResults")} class={r.list}>
        {p.hits.map((hit, i) => (
          <ResultRow
            key={hit.key}
            id={resultId(i)}
            hit={hit}
            selected={i === p.selected}
            onHover={() => i !== p.selected && p.onSelect(i)}
            onOpen={() => void openHit(hit)}
          />
        ))}
      </div>
    </section>
  );
}
