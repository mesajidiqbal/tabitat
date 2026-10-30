import { t } from "@/i18n";
import { openExtPage } from "../actions";
import c from "../components/controls.module.css";
import { IconWarning } from "../icons";
import { recoveryAvailable } from "../store";
import s from "./sections.module.css";

/** Shown when recovery:pending / import:failed exist or this window's match is provisional. */
export function RecoveryBanner() {
  if (!recoveryAvailable.value) return null;
  return (
    <div class={s.banner} role="status">
      <IconWarning />
      <span>{t("recoveryAvailable")}</span>
      <button
        type="button"
        class={`${c.link} ${s.bannerBtn}`}
        onClick={() => openExtPage("/recovery.html")}
      >
        {t("restoreEllipsis")}
      </button>
    </div>
  );
}
