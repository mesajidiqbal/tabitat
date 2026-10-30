/**
 * Customize panel (docs/PHASE4.md §4): widget toggles with ▲▼ reorder, theme, wallpaper. A
 * non-modal dialog at the right; Esc or ✕ closes it and focus returns to the ⚙ button.
 */
import { useEffect, useRef } from "preact/hooks";
import type { Settings, WidgetId } from "@/core/model/types";
import { type MsgKey, t } from "@/i18n";
import { IconButton } from "@/ui/components/IconButton";
import { IconClose } from "@/ui/icons";
import { customizeList, moveWidget, toggleWidget } from "@/ui/widgets/order";
import s from "./dashboard.module.css";
import {
  dashboard,
  dashboardOf,
  dashboardPatch,
  dashSettings,
  settingsNotice,
  updateSettings,
} from "./settings";
import { WallpaperPicker } from "./WallpaperPicker";

export const WIDGET_NAMES: Record<WidgetId, MsgKey> = {
  clock: "dashClock",
  search: "dashSearch",
  quicklinks: "dashQuickLinks",
  workspaces: "workspaces",
  todos: "dashTodos",
  notes: "dashNotes",
  pomodoro: "dashPomodoro",
};
const THEMES: Array<[Settings["theme"], MsgKey]> = [
  ["system", "dashThemeSystem"],
  ["light", "dashThemeLight"],
  ["dark", "dashThemeDark"],
];

const widgets = (f: (w: WidgetId[]) => WidgetId[]) =>
  void updateSettings((cur) => dashboardPatch(cur, { widgets: f(dashboardOf(cur).widgets) }));

export function Customize({ onClose }: { onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  const list = customizeList(dashboard.value.widgets);
  const enabled = list.filter((x) => x.on).length;
  const theme = dashSettings.value.theme;
  useEffect(() => {
    panel.current?.querySelector<HTMLElement>("input, button")?.focus();
  }, []);
  return (
    <div
      ref={panel}
      class={s.panel}
      role="dialog"
      aria-labelledby="customize-h"
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.stopPropagation();
        onClose();
      }}
    >
      <div class={s.panelHead}>
        <h2 id="customize-h">{t("dashCustomize")}</h2>
        <IconButton label={t("dashClose")} icon={<IconClose />} onClick={onClose} />
      </div>
      {settingsNotice.value && (
        <p class={s.notice} role="status">
          {settingsNotice.value}
        </p>
      )}
      <fieldset class={s.fieldset}>
        <legend>{t("dashWidgets")}</legend>
        <ul class={s.widgetList}>
          {list.map(({ id, on }, i) => (
            <li key={id} class={s.inline}>
              <label class={s.grow}>
                <input
                  type="checkbox"
                  checked={on}
                  onChange={(e) => {
                    const v = e.currentTarget.checked;
                    widgets((w) => toggleWidget(w, id, v));
                  }}
                />{" "}
                {t(WIDGET_NAMES[id])}
              </label>
              <IconButton
                label={t("dashMoveUp", t(WIDGET_NAMES[id]))}
                icon={<span aria-hidden="true">▲</span>}
                disabled={!on || i === 0}
                onClick={() => widgets((w) => moveWidget(w, id, -1))}
              />
              <IconButton
                label={t("dashMoveDown", t(WIDGET_NAMES[id]))}
                icon={<span aria-hidden="true">▼</span>}
                disabled={!on || i >= enabled - 1}
                onClick={() => widgets((w) => moveWidget(w, id, 1))}
              />
            </li>
          ))}
        </ul>
      </fieldset>
      <fieldset class={s.fieldset}>
        <legend>{t("dashTheme")}</legend>
        <div class={s.inline}>
          {THEMES.map(([value, key]) => (
            <label key={value}>
              <input
                type="radio"
                name="dash-theme"
                checked={theme === value}
                onChange={() => void updateSettings(() => ({ theme: value }))}
              />{" "}
              {t(key)}
            </label>
          ))}
        </div>
      </fieldset>
      <WallpaperPicker />
    </div>
  );
}
