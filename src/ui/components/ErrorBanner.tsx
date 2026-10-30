/** Inline error line (busy / conflict / limit / …) shown under the search box; dismissible. */
import { t } from "@/i18n";
import { uiError } from "../actions";
import { IconClose } from "../icons";
import c from "./controls.module.css";
import { IconButton } from "./IconButton";

export function ErrorBanner() {
  const err = uiError.value;
  if (!err) return null;
  return (
    <p class={c.error} role="alert">
      <span title={err.detail || undefined}>{err.text}</span>
      <IconButton
        label={t("dismiss")}
        icon={<IconClose size={14} />}
        onClick={() => {
          uiError.value = null;
        }}
      />
    </p>
  );
}
