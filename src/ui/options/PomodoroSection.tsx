import { t } from "@/i18n";
import { Group, NumberField, Section } from "./fields";
import { useSettingsApi } from "./SettingsContext";
import { RANGES } from "./settings";

export function PomodoroSection() {
  const { settings, update } = useSettingsApi();
  const p = settings.pomodoro;
  const save = (patch: Partial<typeof p>) => void update("pomodoro", { pomodoro: patch });
  return (
    <Section id="pomodoro" title={t("optPomodoro")}>
      <Group>
        <NumberField
          label={t("optWork")}
          value={p.workMin}
          {...RANGES.workMin}
          onCommit={(n) => save({ workMin: n })}
        />
        <NumberField
          label={t("optBreak")}
          value={p.breakMin}
          {...RANGES.breakMin}
          onCommit={(n) => save({ breakMin: n })}
        />
        <NumberField
          label={t("optLongBreak")}
          value={p.longBreakMin}
          {...RANGES.longBreakMin}
          onCommit={(n) => save({ longBreakMin: n })}
        />
        <NumberField
          label={t("optRounds")}
          value={p.roundsBeforeLong}
          {...RANGES.rounds}
          onCommit={(n) => save({ roundsBeforeLong: n })}
        />
      </Group>
    </Section>
  );
}
