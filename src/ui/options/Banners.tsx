/** Page-level notices: settings conflict (reloaded) and failed settings writes. */
import { t } from "@/i18n";
import c from "../components/controls.module.css";
import s from "./options.module.css";
import { useSettingsApi } from "./SettingsContext";

export function Banners() {
  const { notice, error, dismiss } = useSettingsApi();
  if (!notice && !error) return null;
  return (
    <div
      class={`${s.notice} ${error ? s.bad : s.warn} ${s.banner}`}
      role={error ? "alert" : "status"}
    >
      <span title={error?.detail || undefined}>{error ? error.text : notice}</span>
      <button type="button" class={`${c.btn} ${c.ghost}`} onClick={dismiss}>
        {t("dismiss")}
      </button>
    </div>
  );
}
