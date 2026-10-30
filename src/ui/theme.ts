/**
 * Applies settings.theme to the page: data-theme="light"|"dark", or no attribute for "system"
 * (theme.css then follows prefers-color-scheme). Every surface calls this from its store effect.
 */
import type { Color, Settings } from "@/core/model/types";

export function applyTheme(theme: Settings["theme"], root: HTMLElement = document.documentElement) {
  if (theme === "light" || theme === "dark") root.dataset.theme = theme;
  else delete root.dataset.theme;
}

export const COLORS: readonly Color[] = [
  "grey",
  "blue",
  "red",
  "yellow",
  "green",
  "pink",
  "purple",
  "cyan",
  "orange",
];

/** CSS custom property for a workspace / tab-group colour (theme.css --ws-<name>). */
export function colorVar(c: Color | string | undefined): string {
  return `var(--ws-${COLORS.includes(c as Color) ? c : "grey"})`;
}
