/**
 * Dashboard widget order (settings.dashboard.widgets) helpers. Pure. The stored list may come
 * from an older version or a sync pull: unknown and repeated ids are dropped.
 */
import type { WidgetId } from "@/core/model/types";

export const ALL_WIDGETS: readonly WidgetId[] = [
  "clock",
  "search",
  "quicklinks",
  "workspaces",
  "todos",
  "notes",
  "pomodoro",
];
/** Widgets of the top row (not grid cards). */
export const TOP_ROW: readonly WidgetId[] = ["clock", "search"];

/** The enabled widgets in their stored order, valid and unique. */
export function enabledWidgets(raw: unknown): WidgetId[] {
  if (!Array.isArray(raw)) return [];
  const out: WidgetId[] = [];
  for (const x of raw)
    if (ALL_WIDGETS.includes(x as WidgetId) && !out.includes(x as WidgetId)) out.push(x);
  return out;
}

/** Grid cards: enabled widgets that are not in the top row, in order. */
export const gridWidgets = (enabled: readonly WidgetId[]): WidgetId[] =>
  enabled.filter((w) => !TOP_ROW.includes(w));

/** The Customize list: enabled widgets in order, then the disabled ones in default order. */
export function customizeList(enabled: readonly WidgetId[]): Array<{ id: WidgetId; on: boolean }> {
  return [
    ...enabled.map((id) => ({ id, on: true })),
    ...ALL_WIDGETS.filter((w) => !enabled.includes(w)).map((id) => ({ id, on: false })),
  ];
}

/** Enables (appended at the end) or disables a widget. */
export function toggleWidget(enabled: readonly WidgetId[], id: WidgetId, on: boolean): WidgetId[] {
  const rest = enabled.filter((w) => w !== id);
  return on ? [...rest, id] : rest;
}

/** Moves an enabled widget one place up (-1) or down (+1); unchanged at the ends or if off. */
export function moveWidget(enabled: readonly WidgetId[], id: WidgetId, delta: -1 | 1): WidgetId[] {
  const list = [...enabled];
  const from = list.indexOf(id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= list.length) return list;
  list.splice(from, 1);
  list.splice(to, 0, id);
  return list;
}

/**
 * The Customize panel's two lists (review C-U2): the top-row widgets as plain toggles in their
 * fixed order, and the grid cards (enabled in order, then the disabled ones) which reorder.
 */
export function customizeGroups(enabled: readonly WidgetId[]): {
  top: Array<{ id: WidgetId; on: boolean }>;
  cards: Array<{ id: WidgetId; on: boolean }>;
} {
  return {
    top: TOP_ROW.map((id) => ({ id, on: enabled.includes(id) })),
    cards: customizeList(enabled).filter((x) => !TOP_ROW.includes(x.id)),
  };
}

/**
 * Moves a grid card one place among the enabled grid cards (-1 up, +1 down): it swaps with the
 * neighbouring card, so top-row ids keep their slots in the stored list. Unchanged at the ends,
 * for a disabled card or a top-row id.
 */
export function moveCard(enabled: readonly WidgetId[], id: WidgetId, delta: -1 | 1): WidgetId[] {
  const list = [...enabled];
  const cards = gridWidgets(list);
  const from = cards.indexOf(id);
  const other = cards[from + delta];
  if (from < 0 || other === undefined) return list;
  const a = list.indexOf(id);
  const b = list.indexOf(other);
  list[a] = other;
  list[b] = id;
  return list;
}
