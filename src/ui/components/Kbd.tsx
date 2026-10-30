import type { ComponentChildren } from "preact";
import s from "./controls.module.css";

/** Keyboard hint. Decorative by default (the shortcut is also in aria-keyshortcuts). */
export function Kbd({
  children,
  hidden = true,
}: {
  children: ComponentChildren;
  hidden?: boolean;
}) {
  return (
    <kbd class={s.kbd} aria-hidden={hidden ? "true" : undefined}>
      {children}
    </kbd>
  );
}
