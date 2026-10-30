/**
 * One row of a tab-like list (live tabs, saved links, recently closed): favicon, title, optional
 * host/meta, hover actions. Keyboard: Enter opens, Delete runs the action marked `del`, an
 * action's `key` runs it, ContextMenu / Shift+F10 opens a menu of all actions.
 */
import type { ComponentChildren } from "preact";
import { useRef } from "preact/hooks";
import { t } from "@/i18n";
import { hostLabel } from "../format";
import type { RovingItem } from "../hooks/useRoving";
import { IconPin, IconSleep } from "../icons";
import { Favicon } from "./Favicon";
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
}

export interface TabRowProps {
  title: string;
  url: string;
  item: RovingItem;
  onOpen: () => void;
  actions?: RowAction[];
  current?: boolean;
  pinned?: boolean;
  suspended?: boolean;
  showHost?: boolean;
  meta?: string;
  inGroup?: boolean;
  disabled?: boolean;
}

export function TabRow(p: TabRowProps) {
  const actions = p.actions ?? [];
  const del = actions.find((a) => a.del);
  const row = useRef<HTMLDivElement | null>(null);
  const menuBtn = useRef<HTMLButtonElement | null>(null);
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.target === e.currentTarget && !p.disabled) {
      const k = e.key;
      const plain = !e.ctrlKey && !e.metaKey && !e.altKey;
      const keyed = plain && !e.shiftKey ? actions.find((a) => a.key === k) : undefined;
      if (k === "Enter" || k === " ") p.onOpen();
      else if (del && k === "Delete") del.run();
      else if (keyed) keyed.run();
      else if (actions.length > 0 && (k === "ContextMenu" || (k === "F10" && e.shiftKey)))
        menuBtn.current?.click();
      else return p.item.onKeyDown(e);
      e.preventDefault();
      return;
    }
    p.item.onKeyDown(e);
  };
  const shortcuts = [
    ...(del ? ["Delete"] : []),
    ...actions.flatMap((a) => (a.key ? [a.key] : [])),
    ...(actions.length > 0 ? ["Shift+F10", "ContextMenu"] : []),
  ].join(" ");
  const two = p.showHost && p.url;
  const cls = [
    s.row,
    two && s.two,
    p.current && s.current,
    p.suspended && s.suspended,
    p.inGroup && s.inGroup,
  ];
  return (
    <div
      role="option"
      aria-selected={p.current === true}
      aria-disabled={p.disabled ? "true" : undefined}
      aria-keyshortcuts={shortcuts || undefined}
      class={cls.filter(Boolean).join(" ")}
      title={p.url ? `${p.title}\n${p.url}` : p.title}
      tabIndex={p.item.tabIndex}
      ref={(el) => {
        row.current = el;
        p.item.ref(el);
      }}
      onFocus={p.item.onFocus}
      onKeyDown={onKeyDown}
      onClick={() => !p.disabled && p.onOpen()}
    >
      <Favicon url={p.url} />
      <span class={s.text}>
        <span class={s.title}>{p.title || p.url}</span>
        {p.showHost && p.url && <span class={s.sub}>{hostLabel(p.url)}</span>}
      </span>
      {p.suspended && (
        <span class={s.tag} title={t("suspendedHint")}>
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
      {actions.length > 0 && (
        <span class={s.actions}>
          {actions.map((a) => (
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
      {actions.length > 0 && (
        <Menu
          label={t("rowActions", p.title || p.url)}
          trigger={null}
          wrapClass={s.menuAnchor}
          triggerClass={s.menuTrigger}
          triggerRef={menuBtn}
          tabIndex={-1}
          returnFocus={() => row.current?.focus()}
          items={actions.map((a) => ({
            label: a.label,
            icon: a.icon,
            danger: a.danger,
            disabled: p.disabled,
            hint: a.del ? <Kbd>Del</Kbd> : a.key ? <Kbd>{a.key.toUpperCase()}</Kbd> : undefined,
            onSelect: a.run,
          }))}
        />
      )}
    </div>
  );
}
