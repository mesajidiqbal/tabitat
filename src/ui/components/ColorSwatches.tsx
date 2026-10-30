/** Colour picker: radio group (forms) or menuitemradio group (inside a Menu). Name + colour. */
import type { Color } from "@/core/model/types";
import { t } from "@/i18n";
import { COLORS, colorVar } from "../theme";
import s from "./forms.module.css";

export interface ColorSwatchesProps {
  value: Color;
  onChange: (c: Color) => void;
  inMenu?: boolean;
}

export function ColorSwatches({ value, onChange, inMenu }: ColorSwatchesProps) {
  const move = (e: KeyboardEvent, i: number) => {
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (d === 0) return;
    e.preventDefault();
    e.stopPropagation();
    const n = (i + d + COLORS.length) % COLORS.length;
    if (!inMenu) onChange(COLORS[n] as Color);
    const parent = (e.currentTarget as HTMLElement).parentElement;
    (parent?.children[n] as HTMLElement | undefined)?.focus();
  };
  const common = (c: Color, i: number) => ({
    key: c,
    type: "button" as const,
    "aria-label": t(`color_${c}`),
    title: t(`color_${c}`),
    class: s.swatch,
    style: { "--sw": colorVar(c) },
    onClick: () => onChange(c),
    onKeyDown: (e: KeyboardEvent) => move(e, i),
  });
  if (inMenu) {
    return (
      // biome-ignore lint/a11y/useSemanticElements: a group of menu items (no fieldset in a menu)
      <div class={s.swatches} role="group" aria-label={t("color")}>
        {COLORS.map((c, i) => (
          <button {...common(c, i)} role="menuitemradio" aria-checked={c === value} tabIndex={-1} />
        ))}
      </div>
    );
  }
  return (
    <div class={s.swatches} role="radiogroup" aria-label={t("color")}>
      {COLORS.map((c, i) => (
        // biome-ignore lint/a11y/useSemanticElements: colour swatches styled as radio buttons
        <button
          {...common(c, i)}
          role="radio"
          aria-checked={c === value}
          tabIndex={c === value ? 0 : -1}
        />
      ))}
    </div>
  );
}
