import type { ComponentChildren } from "preact";
import s from "./misc.module.css";

export function EmptyState(p: { title: string; hint?: string; children?: ComponentChildren }) {
  return (
    <div class={s.empty}>
      <p class={s.emptyTitle}>{p.title}</p>
      {p.hint && <p class={s.emptyHint}>{p.hint}</p>}
      {p.children}
    </div>
  );
}
