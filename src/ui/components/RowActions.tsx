/**
 * Actions of a TabRow: hover / focus-within icon buttons and the keyboard-only menu
 * (ContextMenu / Shift+F10) that lists every action, including menu-only ones.
 */
import type { ComponentChildren, Ref } from "preact";
import { t } from "@/i18n";
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

export function RowActions(p: {
  actions: RowAction[];
  /** Row title (menu label). */
  title: string;
  disabled?: boolean | undefined;
  menuRef: Ref<HTMLButtonElement>;
  returnFocus: () => void;
}) {
  if (p.actions.length === 0) return null;
  const buttons = p.actions.filter((a) => !a.menuOnly);
  return (
    <>
      {buttons.length > 0 && (
        <span class={s.actions}>
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
        </span>
      )}
      <Menu
        label={t("rowActions", p.title)}
        trigger={null}
        wrapClass={s.menuAnchor}
        triggerClass={s.menuTrigger}
        triggerRef={p.menuRef}
        tabIndex={-1}
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
    </>
  );
}
