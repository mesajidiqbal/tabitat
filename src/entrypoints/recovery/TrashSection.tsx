/**
 * "Trash": deleted workspaces / links and archived notes / todo lists (30-day retention). Newest
 * first; each item shows its kind glyph, size (workspaces) and when it will be purged.
 */
import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { LIMITS, type TrashItem } from "@/core/model/types";
import { plural, t } from "@/i18n";
import { send } from "@/messaging/client";
import c from "@/ui/components/controls.module.css";
import { absTime, purgeLabel } from "@/ui/format";
import { IconCheck, IconGrid, IconLink, IconNote } from "@/ui/icons";
import { store } from "@/ui/store";
import s from "./recovery.module.css";
import { ConfirmButton, errStatus, type Status, StatusLine, TabList } from "./shared";

/** A field of a possibly malformed nested record (trash items are not re-validated here). */
const str = (o: unknown, k: string): string => {
  const v = typeof o === "object" && o !== null ? (o as Record<string, unknown>)[k] : undefined;
  return typeof v === "string" ? v : "";
};

/** Saved tabs of a trashed workspace; missing or non-array tabs read as none. */
const trashedTabs = (it: Extract<TrashItem, { kind: "workspace" }>) => {
  const tabs = typeof it.tabs === "object" && it.tabs !== null ? it.tabs.tabs : undefined;
  return Array.isArray(tabs) ? tabs : [];
};

interface Described {
  kind: string;
  name: string;
  icon: ComponentChildren;
  /** "12 tabs" for workspaces. */
  size?: string;
}

function describeItem(item: TrashItem): Described {
  const scope = (sc: string) =>
    sc === "global" ? t("scopeGlobal") : (store.metas.value[sc]?.name ?? sc);
  switch (item.kind) {
    case "workspace":
      return {
        kind: t("kindWorkspace"),
        name: str(item.meta, "name") || item.id,
        icon: <IconGrid />,
        size: plural(trashedTabs(item).length, "tabsOne", "tabsMany"),
      };
    case "link":
      return {
        kind: t("kindLink"),
        name: str(item.link, "title") || str(item.link, "url") || item.id,
        icon: <IconLink />,
      };
    case "note":
      return { kind: t("kindNote"), name: scope(item.scope), icon: <IconNote /> };
    default:
      return { kind: t("kindTodos"), name: scope(item.scope), icon: <IconCheck /> };
  }
}

export function TrashSection() {
  const items = [...store.trash.value.items].sort((a, b) => b.deletedAt - a.deletedAt);
  const [status, setStatus] = useState<Status>(null);
  const run = (p: Promise<unknown>, ok: string) =>
    p.then(
      () => setStatus({ kind: "ok", text: ok }),
      (e: unknown) => setStatus(errStatus(e)),
    );
  const now = Date.now();
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
              <li key={it.id} class={s.item} data-testid="trash-item">
                <span class={s.kindIcon} title={d.kind}>
                  {d.icon}
                </span>
                <div class={s.grow}>
                  <strong>{d.name}</strong> <span class={s.muted}>· {d.kind}</span>
                  {d.size && <span class={s.muted}> · {d.size}</span>}
                  <div class={s.muted}>
                    {t("deletedAt", absTime(it.deletedAt))} ·{" "}
                    {purgeLabel(it.deletedAt, LIMITS.trashRetentionMs, now)}
                  </div>
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
                {it.kind === "workspace" && <TabList tabs={trashedTabs(it)} />}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
