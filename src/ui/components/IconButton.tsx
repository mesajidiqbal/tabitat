import type { ComponentChildren, Ref } from "preact";
import s from "./controls.module.css";

export interface IconButtonProps {
  /** Accessible name and tooltip (icon buttons always carry one). */
  label: string;
  icon: ComponentChildren;
  onClick?: (e: MouseEvent) => void;
  disabled?: boolean;
  tabIndex?: number;
  buttonRef?: Ref<HTMLButtonElement>;
  expanded?: boolean;
  hasPopup?: "menu";
  danger?: boolean;
  keyshortcuts?: string;
  class?: string;
}

export function IconButton(p: IconButtonProps) {
  return (
    <button
      ref={p.buttonRef}
      type="button"
      class={[s.iconBtn, p.danger ? s.danger : "", p.class ?? ""].join(" ")}
      aria-label={p.label}
      title={p.label}
      aria-expanded={p.expanded}
      aria-haspopup={p.hasPopup}
      aria-keyshortcuts={p.keyshortcuts}
      tabIndex={p.tabIndex}
      disabled={p.disabled}
      onClick={p.onClick}
    >
      {p.icon}
    </button>
  );
}

export { s as controls };
