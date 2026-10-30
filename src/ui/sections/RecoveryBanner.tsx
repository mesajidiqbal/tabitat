import { t } from "@/i18n";
import { send } from "@/messaging/client";
import { attempt, openExtPage } from "../actions";
import c from "../components/controls.module.css";
import { IconButton } from "../components/IconButton";
import { IconClose, IconWarning } from "../icons";
import { recoveryAvailable, store } from "../store";
import s from "./sections.module.css";

/**
 * Shown when recovery:pending / import:failed exist or this window's match is provisional; and,
 * separately, when `recovery:hint` says a window of the last session was not restored.
 */
export function RecoveryBanner() {
  const hint = store.hint.value;
  return (
    <>
      {recoveryAvailable.value && (
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
      )}
      {hint && (
        <div class={s.banner} role="status" data-testid="recovery-hint">
          <IconWarning />
          <span>{t("recoveryHint")}</span>
          <button
            type="button"
            class={`${c.link} ${s.bannerBtn}`}
            onClick={() => openExtPage("/recovery.html")}
          >
            {t("openRecovery")}
          </button>
          <IconButton
            label={t("dismiss")}
            icon={<IconClose size={14} />}
            onClick={() => void attempt(() => send("recovery.dismissHint", {}))}
          />
        </div>
      )}
    </>
  );
}
