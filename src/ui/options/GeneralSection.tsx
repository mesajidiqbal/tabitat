import { useId } from "preact/hooks";
import type { Settings } from "@/core/model/types";
import { t } from "@/i18n";
import { Group, NumberField, Section } from "./fields";
import s from "./options.module.css";
import { useSettingsApi } from "./SettingsContext";
import { RANGES } from "./settings";

const THEMES = [
  ["system", "optThemeSystem"],
  ["light", "optThemeLight"],
  ["dark", "optThemeDark"],
] as const;

export function GeneralSection() {
  const { settings, update } = useSettingsApi();
  const id = useId();
  return (
    <Section id="general" title={t("optGeneral")}>
      <Group>
        <div class={s.field}>
          <label class={s.label} for={id}>
            {t("optTheme")}
          </label>
          <select
            id={id}
            class={`${s.control} ${s.select}`}
            value={settings.theme}
            onChange={(e) =>
              void update("general", {
                theme: (e.currentTarget as HTMLSelectElement).value as Settings["theme"],
              })
            }
          >
            {THEMES.map(([v, key]) => (
              <option key={v} value={v}>
                {t(key)}
              </option>
            ))}
          </select>
        </div>
        <NumberField
          label={t("optRestoreLimit")}
          hint={t("optRestoreLimitHint")}
          value={settings.restoreLimit}
          {...RANGES.restoreLimit}
          onCommit={(n) => void update("general", { restoreLimit: n })}
        />
      </Group>
    </Section>
  );
}
