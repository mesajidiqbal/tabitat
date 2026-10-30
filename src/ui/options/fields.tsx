/** Native form controls shared by the options sections. */
import type { ComponentChildren } from "preact";
import { useEffect, useId, useRef, useState } from "preact/hooks";
import { t } from "@/i18n";
import s from "./options.module.css";
import { useSettingsApi } from "./SettingsContext";
import { clamp, parseWhole } from "./settings";

/** A settings section: heading, per-section "Saved" live region, content. */
export function Section(p: {
  id: string;
  title: string;
  lead?: string;
  children?: ComponentChildren;
}) {
  const { saved } = useSettingsApi();
  return (
    <section aria-labelledby={`${p.id}-h`}>
      <div class={s.head}>
        <h2 id={`${p.id}-h`}>{p.title}</h2>
        <span class={s.saved} role="status" aria-live="polite">
          {saved === p.id ? t("optSaved") : ""}
        </span>
      </div>
      {p.lead && <p class={s.lead}>{p.lead}</p>}
      {p.children}
    </section>
  );
}

export function Group(p: { title?: string; children?: ComponentChildren }) {
  return (
    <div class={s.group}>
      {p.title && <h3 class={s.groupTitle}>{p.title}</h3>}
      {p.children}
    </div>
  );
}

export function Toggle(p: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  const hintId = useId();
  return (
    <div class={s.field}>
      <label class={s.toggle}>
        <input
          type="checkbox"
          checked={p.checked}
          aria-describedby={p.hint ? hintId : undefined}
          onChange={(e) => p.onChange((e.currentTarget as HTMLInputElement).checked)}
        />
        <span class={s.label}>{p.label}</span>
      </label>
      {p.hint && (
        <p class={s.hint} id={hintId}>
          {p.hint}
        </p>
      )}
    </div>
  );
}

export interface NumberFieldProps {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  /** A value outside min..max that is also allowed (e.g. 0 = off). */
  off?: number;
  onCommit: (n: number) => void;
}

/**
 * Whole-number input. Valid values are saved 300 ms after the last keystroke; an out-of-range
 * value shows an inline hint and is not saved; on blur it is clamped (or reverted if not a number).
 */
export function NumberField(p: NumberFieldProps) {
  const id = useId();
  const [text, setText] = useState(String(p.value));
  const input = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const typed = parseWhole(text);
  const inRange = (n: number) => n === p.off || (n >= p.min && n <= p.max);
  const valid = typed !== null && inRange(typed);

  // A stored change shows up unless the user is typing in this very field.
  useEffect(() => {
    if (document.activeElement !== input.current) setText(String(p.value));
  }, [p.value]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const edit = (v: string) => {
    setText(v);
    clearTimeout(timer.current);
    const n = parseWhole(v);
    if (n === null || !inRange(n) || n === p.value) return;
    timer.current = setTimeout(() => p.onCommit(n), 300);
  };
  const blur = () => {
    clearTimeout(timer.current);
    if (typed === null) return setText(String(p.value));
    const n = typed === p.off ? typed : clamp(typed, p.min, p.max);
    setText(String(n));
    if (n !== p.value) p.onCommit(n);
  };
  return (
    <div class={s.field}>
      <label class={s.label} for={id}>
        {p.label}
      </label>
      <input
        id={id}
        ref={input}
        class={`${s.control} ${s.num} ${valid || text === "" ? "" : s.invalid}`}
        type="number"
        inputMode="numeric"
        min={p.off === undefined ? p.min : Math.min(p.min, p.off)}
        max={p.max}
        step={p.step}
        value={text}
        aria-invalid={valid ? undefined : "true"}
        aria-describedby={`${id}-h`}
        onInput={(e) => edit((e.currentTarget as HTMLInputElement).value)}
        onBlur={blur}
      />
      <p class={valid ? s.hint : s.err} id={`${id}-h`}>
        {valid ? p.hint : t(p.off === undefined ? "optRange" : "optRangeOff", [p.min, p.max])}
      </p>
    </div>
  );
}
