/**
 * One row of a tab-like list (live tabs, saved links, recently closed): favicon, title, optional
 * host/meta, hover actions. Keyboard: Enter opens, Delete runs the action marked `del`.
 */
import type { ComponentChildren } from "preact";
import { t } from "@/i18n";
import { hostLabel } from "../format";
import type { RovingItem } from "../hooks/useRoving";
import { IconPin, IconSleep } from "../icons";
import { Favicon } from "./Favicon";
import { IconButton } from "./IconButton";
import s from "./rows.module.css";

export interface RowAction {
  label: string;
  icon: ComponentChildren;
  run: () => void;
  /** Also bound to the Delete key on the row. */
  del?: boolean;
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
  const del = p.actions?.find((a) => a.del);
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.target === e.currentTarget && !p.disabled) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        return p.onOpen();
      }
      if (del && e.key === "Delete") {
        e.preventDefault();
        return del.run();
      }
    }
    p.item.onKeyDown(e);
  };
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
      aria-keyshortcuts={del ? "Delete" : undefined}
      class={cls.filter(Boolean).join(" ")}
      title={p.url ? `${p.title}\n${p.url}` : p.title}
      tabIndex={p.item.tabIndex}
      ref={p.item.ref}
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
      {p.actions && p.actions.length > 0 && (
        <span class={s.actions}>
          {p.actions.map((a) => (
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
    </div>
  );
}
