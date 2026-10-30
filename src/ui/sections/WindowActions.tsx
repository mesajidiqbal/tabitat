/** "Suspend others" and "Close N duplicates" for the current window. */
import { plural, t } from "@/i18n";
import { send } from "@/messaging/client";
import { attempt } from "../actions";
import c from "../components/controls.module.css";
import { showToast } from "../components/Toast";
import { IconDupes, IconSleep } from "../icons";
import { busy, store } from "../store";
import { duplicateCount } from "../tabs";
import s from "./sections.module.css";

export function WindowActions() {
  const w = store.windowId.value;
  const dupes = duplicateCount(store.liveTabs.value, chrome.runtime.getURL("/suspended.html"));
  const disabled = w === null || busy.value;
  const suspend = async () => {
    if (w === null) return;
    const n = await attempt(() => send("tabs.suspendOthers", { windowId: w }));
    if (n !== undefined) showToast({ message: plural(n, "suspendedOne", "suspendedMany") });
  };
  const closeDupes = async () => {
    if (w === null) return;
    const n = await attempt(() => send("tabs.closeDuplicates", { windowId: w }));
    if (n !== undefined) showToast({ message: plural(n, "closedDupesOne", "closedDupesMany") });
  };
  return (
    <div class={s.windowActions}>
      <button type="button" class={c.btn} disabled={disabled} onClick={suspend}>
        <IconSleep size={14} />
        {t("suspendOthers")}
      </button>
      <button type="button" class={c.btn} disabled={disabled || dupes === 0} onClick={closeDupes}>
        <IconDupes size={14} />
        {plural(dupes, "closeDupesOne", "closeDupesMany")}
      </button>
    </div>
  );
}
