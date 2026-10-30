/** "Trash": deleted workspaces / links and archived notes / todo lists (30-day retention). */
import { useState } from "preact/hooks";
import type { TrashItem } from "@/core/model/types";
import { t } from "@/i18n";
import { send } from "@/messaging/client";
import { errorText } from "@/ui/actions";
import c from "@/ui/components/controls.module.css";
import { absTime } from "@/ui/format";
import { store } from "@/ui/store";
import s from "./recovery.module.css";
import { ConfirmButton, type Status, StatusLine, TabList } from "./shared";

function describeItem(item: TrashItem): { kind: string; name: string } {
  const scope = (sc: string) =>
    sc === "global" ? t("scopeGlobal") : (store.metas.value[sc]?.name ?? sc);
  switch (item.kind) {
    case "workspace":
      return { kind: t("kindWorkspace"), name: item.meta.name };
    case "link":
      return { kind: t("kindLink"), name: item.link.title || item.link.url };
    case "note":
      return { kind: t("kindNote"), name: scope(item.scope) };
    default:
      return { kind: t("kindTodos"), name: scope(item.scope) };
  }
}

export function TrashSection() {
  const items = [...store.trash.value.items].sort((a, b) => b.deletedAt - a.deletedAt);
  const [status, setStatus] = useState<Status>(null);
  const run = (p: Promise<unknown>, ok: string) =>
    p.then(
      () => setStatus({ kind: "ok", text: ok }),
      (e: unknown) => setStatus({ kind: "err", text: errorText(e) }),
    );
  return (
    <section class={s.card} aria-labelledby="trash-h">
      <div class={s.cardHead}>
        <h2 id="trash-h">
          {t("trashTitle")} ({items.length})
        </h2>
        <ConfirmButton
          label={t("emptyTrash")}
          confirm={t("confirmEmptyTrash")}
          disabled={items.length === 0}
          onConfirm={() => void run(send("trash.purge", {}), t("trashEmptied"))}
        />
      </div>
      <p class={s.muted}>{t("trashLead")}</p>
      <StatusLine status={status} />
      {items.length === 0 ? (
        <p class={s.muted}>{t("trashEmpty")}</p>
      ) : (
        <ul class={s.list}>
          {items.map((it) => {
            const d = describeItem(it);
            return (
              <li key={it.id} class={s.item}>
                <div class={s.grow}>
                  <strong>{d.name}</strong> <span class={s.muted}>· {d.kind}</span>
                  <div class={s.muted}>{t("deletedAt", absTime(it.deletedAt))}</div>
                </div>
                <div class={s.actions}>
                  <button
                    type="button"
                    class={c.btn}
                    onClick={() =>
                      void run(send("trash.restore", { trashId: it.id }), t("restored", d.name))
                    }
                  >
                    {t("restore")}
                  </button>
                  <ConfirmButton
                    label={t("purge")}
                    confirm={t("confirmPurge")}
                    onConfirm={() =>
                      void run(send("trash.purge", { trashId: it.id }), t("purged", d.name))
                    }
                  />
                </div>
                {it.kind === "workspace" && <TabList tabs={it.tabs.tabs} />}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
