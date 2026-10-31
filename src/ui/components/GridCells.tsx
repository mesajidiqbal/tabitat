// biome-ignore-all lint/a11y/useSemanticElements: ARIA grid of div rows (flex rows and card layouts; no table elements)
/**
 * Cells of a grid row (docs/PHASE5.md §2): the primary cell holds the row content and the roving
 * tabindex; the actions cell holds the row's buttons. ArrowRight on the primary cell focuses the
 * first action; inside the actions cell Left/Right move between buttons (Left on the first one
 * goes back to the primary cell) and Up/Down/Home/End move rows like the primary cell does.
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
    e.preventDefault();
    e.stopPropagation();
  };
  return (
    // biome-ignore lint/a11y/useFocusableInteractive: the buttons inside are the focus targets
    <span
      role="gridcell"
      aria-label={t("rowActionsCell")}
      data-cell="actions"
      class={[s.actionsCell, p.class].filter(Boolean).join(" ")}
      onKeyDown={onKeyDown}
    >
      {p.children}
    </span>
  );
}
