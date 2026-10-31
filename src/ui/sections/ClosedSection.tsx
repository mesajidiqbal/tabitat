/** RECENTLY CLOSED (newest first): click reopens as a tab. Collapsible; "Show all" expands. */
import { useState } from "preact/hooks";
import { t } from "@/i18n";
import { openUrl } from "../actions";
import c from "../components/controls.module.css";
import r from "../components/rows.module.css";
import { SectionHeader } from "../components/SectionHeader";
import { TabRow } from "../components/TabRow";
import { relTime } from "../format";
import { useRoving } from "../hooks/useRoving";
import { store } from "../store";
import s from "./sections.module.css";

export function ClosedSection(p: { variant: "popup" | "panel" }) {
  const all = store.recentlyClosed.value;
  const [open, setOpen] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const max = p.variant === "popup" ? 5 : 25;
  const list = showAll ? all : all.slice(0, max);
  const roving = useRoving(open ? list.length : 0);
  if (all.length === 0) return null;
  return (
    <section class={s.section} aria-labelledby="closed-h">
      <SectionHeader
        id="closed-h"
        title={t("recentlyClosed")}
        count={all.length}
        sticky={p.variant === "panel"}
        open={open}
        controls="closed-list"
        onToggle={() => setOpen(!open)}
      />
      {open && (
        // biome-ignore lint/a11y/useSemanticElements: ARIA grid of div rows (flex rows / cards; no table elements)
        <div
          id="closed-list"
          role="grid"
          aria-labelledby="closed-h"
          aria-rowcount={all.length}
          class={r.list}
        >
          {list.map((c, i) => (
            <TabRow
              key={c.id}
              title={c.title}
              url={c.url}
              item={roving.item(i)}
              rowIndex={i + 1}
              meta={relTime(c.closedAt)}
              showHost={p.variant === "panel"}
              onOpen={() => void openUrl(c.url)}
            />
          ))}
        </div>
      )}
      {open && all.length > max && (
        <div class={s.more}>
          <button
            type="button"
            class={`${c.btn} ${c.ghost}`}
            aria-controls="closed-list"
            aria-expanded={showAll}
            onClick={() => setShowAll(!showAll)}
          >
            {showAll ? t("showLess") : t("showAll", all.length)}
          </button>
        </div>
      )}
    </section>
  );
}
