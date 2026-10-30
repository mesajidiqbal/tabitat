/**
 * Quick links (docs/PHASE4.md §4): favicon tiles, "+" adds, tile menu edits / moves / removes
 * (8 s Undo toast re-adds at the same place), drag reorder, cap LIMITS.quickLinks. Writes
 * `quicklink.set` (whole list, expectedRev) through useSyncedRecord.
 */
import { useState } from "preact/hooks";
import { newId } from "@/core/model/id";
import { Keys, type QuickLink } from "@/core/model/types";
import { t } from "@/i18n";
import { send } from "@/messaging/client";
import c from "../components/controls.module.css";
import { EmptyState } from "../components/EmptyState";
import { showToast } from "../components/Toast";
import { IconPlus } from "../icons";
import { sanitizeQuickLinks, sanitizeRev } from "../sanitize";
import { store } from "../store";
import { Card, type WidgetProps } from "./Card";
import { QuickLinkForm } from "./QuickLinkForm";
import { QuickLinkTile } from "./QuickLinkTile";
import {
  addLink,
  moveLink,
  moveLinkTo,
  QUICKLINK_CAP,
  reinsertLink,
  removeLink,
  sortLinks,
  updateLink,
} from "./quicklinks-logic";
import { useSyncedRecord } from "./useSyncedRecord";
import s from "./widgets.module.css";

export function QuickLinksGrid({ compact }: WidgetProps) {
  const rec = useSyncedRecord<QuickLink[]>({
    stored: { value: store.quicklinks.value, rev: store.quicklinksRev.value },
    write: (items, expectedRev) => send("quicklink.set", { items, expectedRev }).then((r) => r.rev),
    reread: async () => {
      const raw = (await chrome.storage.local.get(Keys.quicklinks))[Keys.quicklinks];
      return { value: sanitizeQuickLinks(raw), rev: sanitizeRev(raw) };
    },
    delay: 0,
  });
  const links = sortLinks(rec.value);
  /** "new" = the add form; an id = editing that link. */
  const [form, setForm] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ id: string; over: string | null } | null>(null);
  const full = links.length >= QUICKLINK_CAP;
  const editing = form && form !== "new" ? links.find((x) => x.id === form) : undefined;

  const remove = (link: QuickLink, index: number) => {
    rec.apply((v) => removeLink(v, link.id));
    showToast({
      message: t("dashLinkRemoved", link.title || link.url),
      duration: 8000,
      action: { label: t("undo"), run: () => rec.apply((v) => reinsertLink(v, link, index)) },
    });
  };

  const addButton = !full && form === null && (
    <button
      type="button"
      class={`${c.btn} ${c.ghost}`}
      onClick={() => setForm("new")}
      aria-label={t("dashLinkAdd")}
    >
      <IconPlus size={14} />
      {t("new")}
    </button>
  );

  return (
    <Card id="quicklinks" title={t("dashQuickLinks")} compact={compact} actions={addButton}>
      {form !== null && (
        <QuickLinkForm
          key={form}
          {...(editing ? { initial: { url: editing.url, title: editing.title } } : {})}
          onCancel={() => setForm(null)}
          onSave={(url, title) => {
            const id = form === "new" ? newId() : form;
            rec.apply((v) =>
              form === "new" ? addLink(v, { id, url, title }) : updateLink(v, id, { url, title }),
            );
            setForm(null);
          }}
        />
      )}
      {links.length === 0 ? (
        form === null && (
          <EmptyState title={t("dashLinksEmpty")} hint={t("dashLinksEmptyHint")}>
            <button type="button" class={c.btn} onClick={() => setForm("new")}>
              {t("dashLinkAdd")}
            </button>
          </EmptyState>
        )
      ) : (
        <ul class={s.tiles} aria-label={t("dashQuickLinks")}>
          {links.map((link, i) => (
            <QuickLinkTile
              key={link.id}
              link={link}
              first={i === 0}
              last={i === links.length - 1}
              dragOver={drag?.over === link.id && drag.id !== link.id}
              onEdit={() => setForm(link.id)}
              onRemove={() => remove(link, i)}
              onMove={(delta) => rec.apply((v) => moveLink(v, link.id, delta))}
              onDragStart={() => setDrag({ id: link.id, over: null })}
              onDragOver={() =>
                drag && drag.over !== link.id && setDrag({ ...drag, over: link.id })
              }
              onDrop={() => {
                const from = drag?.id;
                if (from && from !== link.id) rec.apply((v) => moveLinkTo(v, from, link.id));
                setDrag(null);
              }}
              onDragEnd={() => setDrag(null)}
            />
          ))}
        </ul>
      )}
      {full && <p class={s.muted}>{t("dashLinksFull", QUICKLINK_CAP)}</p>}
    </Card>
  );
}
