/**
 * One row of a tab-like list (live tabs, saved links, recently closed): favicon, title, optional
 * host/meta/chip, hover actions (RowActions). Keyboard: Enter opens, Delete runs the action
 * marked `del`, an action's `key` runs it, ContextMenu / Shift+F10 / right-click opens the menu.
 * Draggable when `onDragStart` is given (tab rows onto Saved links).
 */
import { useRef } from "preact/hooks";
import { t } from "@/i18n";
import { hostLabel } from "../format";
import type { RovingItem } from "../hooks/useRoving";
import { IconPin, IconSleep } from "../icons";
import { Favicon } from "./Favicon";
import { type RowAction, RowActions, rowShortcuts, useRowMenu } from "./RowActions";
import s from "./rows.module.css";

export type { RowAction } from "./RowActions";

export interface TabRowProps {
  title: string;
  url: string;
  item: RovingItem;
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
  const row = useRef<HTMLDivElement | null>(null);
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
    <div
      role="option"
      aria-selected={p.current === true}
      aria-disabled={p.disabled ? "true" : undefined}
      aria-keyshortcuts={shortcuts || undefined}
      class={cls.filter(Boolean).join(" ")}
      title={p.url ? `${p.title}\n${p.url}` : p.title}
      tabIndex={p.item.tabIndex}
      draggable={drag ? true : undefined}
      onDragStart={drag ? p.onDragStart : undefined}
      ref={(el) => {
        row.current = el;
        p.item.ref(el);
      }}
      onFocus={p.item.onFocus}
      onKeyDown={onKeyDown}
      onContextMenu={menu.onContextMenu}
      onClick={() => !p.disabled && p.onOpen()}
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
      <RowActions
        actions={actions}
        title={p.title || p.url}
        disabled={p.disabled}
        menuRef={menu.menuRef}
        returnFocus={() => row.current?.focus()}
      />
    </div>
  );
}
