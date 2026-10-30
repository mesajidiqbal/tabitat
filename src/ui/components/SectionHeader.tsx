import type { ComponentChildren } from "preact";
import { IconChevronDown, IconChevronRight } from "../icons";
import s from "./SectionHeader.module.css";

export interface SectionHeaderProps {
  id: string;
  title: string;
  count?: number;
  sticky?: boolean;
  /** Makes the title a disclosure button. */
  open?: boolean;
  onToggle?: () => void;
  controls?: string;
  children?: ComponentChildren;
}

export function SectionHeader(p: SectionHeaderProps) {
  const count = p.count === undefined ? null : <span class={s.count}>({p.count})</span>;
  return (
    <div class={`${s.header} ${p.sticky ? s.sticky : ""}`}>
      <h2 class={s.title} id={p.id}>
        {p.onToggle ? (
          <button
            type="button"
            class={s.toggle}
            aria-expanded={p.open}
            aria-controls={p.controls}
            onClick={p.onToggle}
          >
            {p.open ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
            {p.title} {count}
          </button>
        ) : (
          <>
            {p.title} {count}
          </>
        )}
      </h2>
      {p.children && <div class={s.actions}>{p.children}</div>}
    </div>
  );
}
