import { t } from "@/i18n";
import { op, store } from "../store";
import s from "./misc.module.css";

/** "Switching to Research… 8/20", driven by op.status polling (store.opLive). */
export function ProgressRow() {
  const current = op.value;
  const pending = store.pendingSwitch.value;
  if (!current && !pending) return null;
  const to = current?.to ?? pending?.to ?? "";
  const name = store.metas.value[to]?.name ?? "…";
  const total = current?.incoming.length ?? 0;
  const done = current ? Object.keys(current.createdTabIds).length : 0;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return (
    <div class={s.progress} role="status" aria-live="polite">
      <span>
        {t("switchingTo", name)}
        {total > 0 ? ` ${done}/${total}` : ""}
      </span>
      <div
        class={s.bar}
        role="progressbar"
        aria-label={t("switchProgress")}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
      >
        <div class={s.fill} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
