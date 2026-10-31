/**
 * Actions cell of a TabRow: hover / focus-within icon buttons plus a visible "…" overflow button
 * that opens a menu of every action, including menu-only ones. The same menu opens from the
 * keyboard (ContextMenu / Shift+F10) and on right-click of the row (`useRowMenu`).
 */
import type { ComponentChildren, Ref } from "preact";
import { useRef } from "preact/hooks";
import { t } from "@/i18n";
import type { RovingItem } from "../hooks/useRoving";
import { IconMore } from "../icons";
import c from "./controls.module.css";
import { ActionsCell } from "./GridCells";
import { IconButton } from "./IconButton";
import { Kbd } from "./Kbd";
import { Menu } from "./Menu";
import s from "./rows.module.css";

export interface RowAction {
  label: string;
  icon: ComponentChildren;
  run: () => void;
  /** Also bound to the Delete key on the row. */
  del?: boolean;
  /** Single-letter shortcut on the row (e.g. "p" for Park). */
  key?: string;
  danger?: boolean;
  /** Listed in the row menu only (no hover button). */
  menuOnly?: boolean;
}

/** Shortcut list for aria-keyshortcuts (Delete, letters, menu keys). */
export function rowShortcuts(actions: readonly RowAction[]): string {
  if (actions.length === 0) return "";
  return [
    ...(actions.some((a) => a.del) ? ["Delete"] : []),
    ...actions.flatMap((a) => (a.key ? [a.key] : [])),
    "Shift+F10",
    "ContextMenu",
  ].join(" ");
}

/**
 * The row menu's trigger ref and openers: `open()` for the menu keys, `onContextMenu` for a
 * right-click on the row (replaces the browser menu). Both do nothing when `enabled` is false.
 */
export function useRowMenu(enabled: boolean) {
  const menuRef = useRef<HTMLButtonElement | null>(null);
  const open = () => {
    if (enabled) menuRef.current?.click();
  };
  const onContextMenu = (e: MouseEvent) => {
    if (!enabled) return;
    e.preventDefault();
    if (menuRef.current?.getAttribute("aria-expanded") !== "true") open();
  };
  return { menuRef, open, onContextMenu };
}

export function RowActions(p: {
  actions: RowAction[];
  /** Row title (menu label). */
  title: string;
  disabled?: boolean | undefined;
  menuRef: Ref<HTMLButtonElement>;
  returnFocus: () => void;
  /** The row's roving item (Up/Down/Home/End from an action move rows). */
  item: RovingItem;
}) {
  if (p.actions.length === 0) return null;
  const buttons = p.actions.filter((a) => !a.menuOnly);
  return (
    <ActionsCell item={p.item} class={s.actions}>
      {buttons.map((a) => (
        <IconButton
          key={a.label}
          label={a.label}
          icon={a.icon}
          tabIndex={-1}
          danger={a.danger}
          disabled={p.disabled}
          onClick={(e) => {
            e.stopPropagation();
            a.run();
          }}
        />
      ))}
      <Menu
        label={t("rowActions", p.title)}
        trigger={<IconMore size={14} />}
        triggerClass={c.iconBtn}
        triggerRef={p.menuRef}
        tabIndex={-1}
        disabled={p.disabled}
        returnFocus={p.returnFocus}
        items={p.actions.map((a) => ({
          label: a.label,
          icon: a.icon,
          danger: a.danger,
          disabled: p.disabled,
          hint: a.del ? <Kbd>Del</Kbd> : a.key ? <Kbd>{a.key.toUpperCase()}</Kbd> : undefined,
          onSelect: a.run,
        }))}
      />
    </ActionsCell>
  );
}
