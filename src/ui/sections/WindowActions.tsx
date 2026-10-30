/** "Suspend others" and "Close N duplicates" (with Undo) for the current window. */
import { plural, t } from "@/i18n";
import c from "../components/controls.module.css";
import { IconDupes, IconSleep } from "../icons";
import { busy, store, windowDuplicates } from "../store";
import { closeDuplicates, suspendOthers } from "../tabActions";
import s from "./sections.module.css";

export function WindowActions() {
  const w = store.windowId.value;
  const dupes = windowDuplicates.value;
  const disabled = w === null || busy.value;
  return (
    <div class={s.windowActions}>
      <button type="button" class={c.btn} disabled={disabled} onClick={() => void suspendOthers()}>
        <IconSleep size={14} />
        {t("suspendOthers")}
      </button>
      <button
        type="button"
        class={c.btn}
        disabled={disabled || dupes === 0}
        onClick={() => void closeDuplicates()}
      >
        <IconDupes size={14} />
        {plural(dupes, "closeDupesOne", "closeDupesMany")}
      </button>
    </div>
  );
}
