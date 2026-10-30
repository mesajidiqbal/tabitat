/** One search hit (option of the results listbox; focus stays in the search box). */
import { useEffect, useRef } from "preact/hooks";
import { t } from "@/i18n";
import { hostLabel } from "../format";
import type { UiHit } from "../search";
import { store } from "../store";
import { colorVar } from "../theme";
import { Favicon } from "./Favicon";
import s from "./rows.module.css";

const KIND = {
  workspace: "kindWorkspace",
  tab: "kindTab",
  workspaceTab: "kindSaved",
  link: "kindLink",
  quicklink: "kindLink",
  closed: "kindClosed",
} as const;

export function ResultRow(p: {
  id: string;
  hit: UiHit;
  selected: boolean;
  onOpen: () => void;
  onHover: () => void;
}) {
  const { hit } = p;
  const el = useRef<HTMLDivElement>(null);
  // Keep the highlighted hit visible while arrowing (focus stays in the search box).
  useEffect(() => {
    if (p.selected) el.current?.scrollIntoView?.({ block: "nearest" });
  }, [p.selected]);
  const ws = hit.workspaceId ? store.metas.value[hit.workspaceId] : undefined;
  const sub = hit.kind === "workspace" ? "" : hostLabel(hit.url);
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard is handled by the combobox input
    <div
      ref={el}
      id={p.id}
      role="option"
      tabIndex={-1}
      aria-selected={p.selected}
      class={`${s.row} ${s.two} ${p.selected ? s.hl : ""}`}
      onClick={p.onOpen}
      onMouseMove={p.onHover}
    >
      {hit.kind === "workspace" ? (
        <span class={`${s.dot} ${s.dotOn}`} style={{ "--dot": colorVar(ws?.color) }} />
      ) : (
        <Favicon url={hit.url} />
      )}
      <span class={s.text}>
        <span class={s.title} dangerouslySetInnerHTML={{ __html: hit.titleHtml }} />
        {(sub || (ws && hit.kind !== "workspace")) && (
          <span class={s.sub}>
            {sub}
            {ws && hit.kind !== "workspace" ? ` · ${ws.name}` : ""}
          </span>
        )}
      </span>
      <span class={s.kind}>{t(KIND[hit.kind])}</span>
    </div>
  );
}
