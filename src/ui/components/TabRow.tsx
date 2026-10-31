// biome-ignore-all lint/a11y/useSemanticElements: ARIA grid of div rows (flex rows and card layouts; no table elements)
/**
 * One grid row of a tab-like list (live tabs, saved links, recently closed): a primary cell
 * (favicon, title, optional host/meta/chip; holds the roving tabindex) and the actions cell
 * (RowActions). Keyboard on the primary cell: Enter / Space open, Delete runs the action marked
 * `del`, an action's `key` runs it, ContextMenu / Shift+F10 / right-click opens the menu,
 * ArrowRight moves into the actions. Draggable when `onDragStart` is given (onto Saved links).
 */
import { useRef } from "preact/hooks";
import { t } from "@/i18n";
import { hostLabel } from "../format";
import type { RovingItem } from "../hooks/useRoving";
import { IconPin, IconSleep } from "../icons";
import { Favicon } from "./Favicon";
import { focusActions } from "./GridCells";
import { type RowAction, RowActions, rowShortcuts, useRowMenu } from "./RowActions";
import s from "./rows.module.css";

export type { RowAction } from "./RowActions";

export interface TabRowProps {
  title: string;
  url: string;
  item: RovingItem;
  /** 1-based position in the grid (aria-rowindex). */
  rowIndex?: number;
  onOpen: () => void;
  actions?: RowAction[];
  current?: boolean;
  pinned?: boolean;
  suspended?: boolean;
  /** Tooltip of the suspended glyph (default: "not loaded yet"). */
  suspendedHint?: string;
  /** Small text chip after the title (e.g. "Duplicate"). */
  chip?: string;
  showHost?: boolean;
  meta?: string;
  inGroup?: boolean;
  disabled?: boolean;
  onDragStart?: (e: DragEvent) => void;
}

export function TabRow(p: TabRowProps) {
  const actions = p.actions ?? [];
  const del = actions.find((a) => a.del);
  const cell = useRef<HTMLDivElement | null>(null);
  const menu = useRowMenu(actions.length > 0 && !p.disabled);
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.target === e.currentTarget && !p.disabled) {
      const k = e.key;
      const plain = !e.ctrlKey && !e.metaKey && !e.altKey;
      const keyed = plain && !e.shiftKey ? actions.find((a) => a.key === k) : undefined;
      if (k === "Enter" || k === " ") p.onOpen();
      else if (del && k === "Delete") del.run();
      else if (keyed) keyed.run();
      else if (actions.length > 0 && (k === "ContextMenu" || (k === "F10" && e.shiftKey)))
        menu.open();
      else if (k === "ArrowRight" && plain && !e.shiftKey)
        focusActions(e.currentTarget as HTMLElement);
      else return p.item.onKeyDown(e);
      e.preventDefault();
      return;
    }
    p.item.onKeyDown(e);
  };
  const shortcuts = rowShortcuts(actions);
  const two = p.showHost && p.url;
  const cls = [
    s.row,
    two && s.two,
    p.current && s.current,
    p.suspended && s.suspended,
    p.inGroup && s.inGroup,
  ];
  const drag = p.onDragStart && !p.disabled;
  return (
    // biome-ignore lint/a11y/useFocusableInteractive lint/a11y/useKeyWithClickEvents: focus and keys live on the primary cell; the row click is the pointer shortcut
    <div
      role="row"
      aria-rowindex={p.rowIndex}
      aria-disabled={p.disabled ? "true" : undefined}
      class={cls.filter(Boolean).join(" ")}
      title={p.url ? `${p.title}\n${p.url}` : p.title}
      draggable={drag ? true : undefined}
      onDragStart={drag ? p.onDragStart : undefined}
      onContextMenu={menu.onContextMenu}
      onClick={() => !p.disabled && p.onOpen()}
    >
      <div
        role="gridcell"
        class={s.cell}
        aria-keyshortcuts={shortcuts || undefined}
        tabIndex={p.item.tabIndex}
        ref={(el) => {
          cell.current = el;
          p.item.ref(el);
        }}
        onFocus={p.item.onFocus}
        onKeyDown={onKeyDown}
      >
        <Favicon url={p.url} />
        <span class={s.text}>
          <span class={s.title}>{p.title || p.url}</span>
          {p.showHost && p.url && <span class={s.sub}>{hostLabel(p.url)}</span>}
        </span>
        {p.chip && <span class={`${s.tag} ${s.chip}`}>{p.chip}</span>}
        {p.suspended && (
          <span class={s.tag} title={p.suspendedHint ?? t("suspendedHint")} data-testid="suspended">
            <IconSleep size={12} />
            <span class="sr-only">{t("suspended")}</span>
          </span>
        )}
        {p.pinned && (
          <span class={s.tag} title={t("pinned")}>
            <IconPin size={12} />
            <span class="sr-only">{t("pinned")}</span>
          </span>
        )}
        {p.current && <span class="sr-only">{t("activeTab")}</span>}
        {p.meta && <span class={s.meta}>{p.meta}</span>}
      </div>
      <RowActions
        actions={actions}
        title={p.title || p.url}
        disabled={p.disabled}
        menuRef={menu.menuRef}
        returnFocus={() => cell.current?.focus()}
        item={p.item}
      />
    </div>
  );
}
