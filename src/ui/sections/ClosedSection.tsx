/** RECENTLY CLOSED (newest first): click reopens as a tab. Collapsible. */
import { useState } from "preact/hooks";
import { t } from "@/i18n";
import { openUrl } from "../actions";
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
  const max = p.variant === "popup" ? 5 : 25;
  const list = all.slice(0, max);
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
        <div id="closed-list" role="listbox" aria-labelledby="closed-h" class={r.list}>
          {list.map((c, i) => (
            <TabRow
              key={c.id}
              title={c.title}
              url={c.url}
              item={roving.item(i)}
              meta={relTime(c.closedAt)}
              showHost={p.variant === "panel"}
              onOpen={() => void openUrl(c.url)}
            />
          ))}
        </div>
      )}
      {open && all.length > max && <p class={s.more}>{t("andMore", all.length - max)}</p>}
    </section>
  );
}
