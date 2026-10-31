// biome-ignore-all lint/a11y/useSemanticElements: ARIA grid of div rows (flex rows and card layouts; no table elements)
import { t } from "@/i18n";
import type { RovingItem } from "../hooks/useRoving";
import { IconChevronDown, IconChevronRight } from "../icons";
import type { UiGroup } from "../tabs";
import { colorVar } from "../theme";
import s from "./rows.module.css";

/**
 * Collapsible tab-group header (collapse is local to this list, not the browser group): a grid
 * row with one cell holding the toggle button (the roving node of the Tabs grid).
 */
export function TabGroupHeader(p: {
  id: string;
  group: UiGroup;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  /** Roving node of the Tabs list (Enter / Space toggle natively: it is a button). */
  item: RovingItem;
  /** 1-based position in the grid (aria-rowindex). */
  rowIndex?: number;
}) {
  const name = p.group.title || t("unnamedGroup");
  return (
    // biome-ignore lint/a11y/useFocusableInteractive: the toggle button inside holds the focus
    <div role="row" aria-rowindex={p.rowIndex}>
      {/* biome-ignore lint/a11y/useFocusableInteractive: the toggle button inside holds the focus */}
      <div role="gridcell">
        <button
          type="button"
          id={p.id}
          class={s.groupHead}
          aria-expanded={!p.collapsed}
          style={{ "--dot": colorVar(p.group.color) }}
          tabIndex={p.item.tabIndex}
          ref={p.item.ref}
          onFocus={p.item.onFocus}
          onKeyDown={p.item.onKeyDown}
          onClick={p.onToggle}
        >
          {p.collapsed ? <IconChevronRight size={12} /> : <IconChevronDown size={12} />}
          <span class={s.groupBar} />
          <span>{t("groupLabel", name)}</span>
          <span class={s.meta}>({p.count})</span>
        </button>
      </div>
    </div>
  );
}
