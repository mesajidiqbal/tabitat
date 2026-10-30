/**
 * Small popover menu (role=menu) for row "…" actions and the header switcher. Fixed-positioned
 * under its trigger (flips up near the bottom), arrows move, Esc closes and refocuses.
 */
import type { ComponentChildren, Ref } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import s from "./Menu.module.css";

export interface MenuItem {
  label: string;
  onSelect: () => void;
  icon?: ComponentChildren;
  danger?: boolean;
  disabled?: boolean;
  hint?: ComponentChildren;
}

export interface MenuProps {
  label: string;
  items: MenuItem[];
  /** Rendered under the items (e.g. colour swatches); gets `close`. */
  extra?: (close: () => void) => ComponentChildren;
  trigger: ComponentChildren;
  triggerClass?: string;
  triggerRef?: Ref<HTMLButtonElement>;
  tabIndex?: number;
  disabled?: boolean;
}

const ITEMS = '[role^="menuitem"]:not([aria-disabled="true"])';

export function Menu(p: MenuProps) {
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const btn = useRef<HTMLButtonElement | null>(null);
  const pop = useRef<HTMLDivElement>(null);
  const close = (refocus = true) => {
    setPos(null);
    if (refocus) btn.current?.focus();
  };
  const toggle = () => {
    if (pos) return close();
    const r = btn.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 4, right: Math.max(4, window.innerWidth - r.right) });
  };
  useLayoutEffect(() => {
    const el = pop.current;
    if (!pos || !el) return;
    const r = el.getBoundingClientRect();
    const b = btn.current?.getBoundingClientRect();
    if (b && r.bottom > window.innerHeight - 4)
      el.style.top = `${Math.max(4, b.top - r.height - 4)}px`;
    el.querySelector<HTMLElement>(ITEMS)?.focus();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!el.contains(t) && !btn.current?.contains(t)) close(false);
    };
    document.addEventListener("mousedown", onDown, true);
    return () => document.removeEventListener("mousedown", onDown, true);
  }, [pos !== null]);
  const onKeyDown = (e: KeyboardEvent) => {
    const list = [...(pop.current?.querySelectorAll<HTMLElement>(ITEMS) ?? [])];
    const i = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown") list[(i + 1) % list.length]?.focus();
    else if (e.key === "ArrowUp") list[(i - 1 + list.length) % list.length]?.focus();
    else if (e.key === "Home") list[0]?.focus();
    else if (e.key === "End") list[list.length - 1]?.focus();
    else if (e.key === "Escape") close();
    else if (e.key === "Tab") close(false);
    else return;
    if (e.key !== "Tab") e.preventDefault();
    e.stopPropagation();
  };
  const setBtn = (el: HTMLButtonElement | null) => {
    btn.current = el;
    const r = p.triggerRef;
    if (typeof r === "function") r(el);
    else if (r) r.current = el;
  };
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: stops row activation; keys handled by the menu
    <span
      class={s.wrap}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.key === "Enter" && e.stopPropagation()}
    >
      <button
        ref={setBtn}
        type="button"
        class={p.triggerClass ?? s.trigger}
        aria-label={p.label}
        title={p.label}
        aria-haspopup="menu"
        aria-expanded={pos !== null}
        tabIndex={p.tabIndex}
        disabled={p.disabled}
        onClick={toggle}
      >
        {p.trigger}
      </button>
      {pos && (
        <div
          ref={pop}
          role="menu"
          aria-label={p.label}
          class={s.menu}
          style={{ top: `${pos.top}px`, right: `${pos.right}px` }}
          onKeyDown={onKeyDown}
        >
          {p.items.map((it) => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              tabIndex={-1}
              aria-disabled={it.disabled ? "true" : undefined}
              class={`${s.item} ${it.danger ? s.dangerItem : ""}`}
              onClick={() => {
                if (it.disabled) return;
                close();
                it.onSelect();
              }}
            >
              {it.icon}
              <span>{it.label}</span>
              {it.hint}
            </button>
          ))}
          {p.extra && <div class={s.sep} />}
          {p.extra?.(() => close())}
        </div>
      )}
    </span>
  );
}
