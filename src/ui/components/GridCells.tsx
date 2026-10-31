// biome-ignore-all lint/a11y/useSemanticElements: ARIA grid of div rows (flex rows and card layouts; no table elements)
/**
 * Cells of a grid row (docs/PHASE5.md §2): the primary cell holds the row content and the roving
 * tabindex; the actions cell holds the row's buttons. ArrowRight on the primary cell focuses the
 * first action; inside the actions cell Left/Right move between buttons (Left on the first one
 * goes back to the primary cell), Up/Down move to the neighbouring row's actions (or its primary
 * cell when it has none) and Home/End move to the first/last row's primary cell. Focus landing
 * on an action (a pointer click) makes the row the roving tab stop.
 */
import type { ComponentChildren } from "preact";
import { t } from "@/i18n";
import type { RovingItem } from "../hooks/useRoving";
import s from "./rows.module.css";

const ACTIONS = '[data-cell="actions"]';

/** Enabled buttons of an actions cell (not the items of a menu opened from it). */
const buttons = (cell: Element): HTMLElement[] =>
  [...cell.querySelectorAll<HTMLElement>("button:not(:disabled)")].filter(
    (b) => b.closest('[role="menu"]') === null,
  );

/** ArrowRight on a primary cell: focus the first action of its row. False when there is none. */
export function focusActions(primary: HTMLElement): boolean {
  const cell = primary.parentElement?.querySelector(`:scope > ${ACTIONS}`);
  const first = cell ? buttons(cell)[0] : undefined;
  first?.focus();
  return first !== undefined;
}

export function ActionsCell(p: { item: RovingItem; class?: string; children: ComponentChildren }) {
  const onKeyDown = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    if (e.altKey || e.ctrlKey || e.metaKey || target.closest('[role="menu"]')) return;
    const cell = e.currentTarget as HTMLElement;
    const list = buttons(cell);
    const i = list.indexOf(target);
    if (i < 0) return;
    if (e.key === "ArrowRight") list[i + 1]?.focus();
    else if (e.key === "ArrowLeft") {
      if (i > 0) list[i - 1]?.focus();
      else cell.parentElement?.querySelector<HTMLElement>(':scope > [role="gridcell"]')?.focus();
    } else if (!p.item.nav(e.key)) return;
    else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      // APG: vertical arrows keep the column: land on the new row's actions when it has any.
      const row = document.activeElement?.closest('[role="row"]');
      const next = row?.querySelector(`:scope > ${ACTIONS}`);
      const first = next ? buttons(next)[0] : undefined;
      first?.focus();
    }
    e.preventDefault();
    e.stopPropagation();
  };
  // A pointer click on an action makes this row the roving tab stop (and the node the "focused
  // node removed" repair watches), as keyboard paths through the primary cell do (C2.1).
  const onFocusIn = (e: FocusEvent) => {
    if (!(e.target as HTMLElement).closest('[role="menu"]')) p.item.onFocus();
  };
  // "Actions" is a description, not the cell's name: an open row menu renders inside the cell,
  // and a name that leaves out its visible items fails label-content-name-mismatch (axe, C3.6).
  // The cell is named from its content (the buttons' labels).
  return (
    // biome-ignore lint/a11y/useFocusableInteractive: the buttons inside are the focus targets
    <span
      role="gridcell"
      aria-description={t("rowActionsCell")}
      data-cell="actions"
      class={[s.actionsCell, p.class].filter(Boolean).join(" ")}
      onKeyDown={onKeyDown}
      onFocusIn={onFocusIn}
    >
      {p.children}
    </span>
  );
}
