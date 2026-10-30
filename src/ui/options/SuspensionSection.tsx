import { t } from "@/i18n";
import { Group, NumberField, Section, Toggle } from "./fields";
import { useSettingsApi } from "./SettingsContext";
import { RANGES } from "./settings";
import { WhitelistEditor } from "./WhitelistEditor";

export function SuspensionSection() {
  const { settings, update } = useSettingsApi();
  const { suspend } = settings;
  return (
    <Section id="suspension" title={t("optSuspension")}>
      <Group>
        <Toggle
          label={t("optSuspendEnable")}
          hint={t("optSuspendCaveat")}
          checked={suspend.enabled}
          onChange={(v) => void update("suspension", { suspend: { enabled: v } })}
        />
        <NumberField
          label={t("optSuspendAfter")}
          value={suspend.afterMinutes}
          {...RANGES.suspendMinutes}
          onCommit={(n) => void update("suspension", { suspend: { afterMinutes: n } })}
        />
        <WhitelistEditor />
      </Group>
    </Section>
  );
}
