/**
 * Quick links (docs/PHASE4.md §4): favicon tiles, "+" adds, tile menu edits / moves / removes
 * (8 s Undo toast re-adds at the same place), drag reorder, cap LIMITS.quickLinks. Writes
 * `quicklink.set` (whole list, expectedRev) through useSyncedRecord. Tiles are one Tab stop
 * (roving focus); the form stays open with its values until the worker has the change, and
 * focus returns to the edited tile or the Add button when it closes.
 */
import { useRef, useState } from "preact/hooks";
import { newId } from "@/core/model/id";
import { Keys, type QuickLink } from "@/core/model/types";
import { t } from "@/i18n";
import { send } from "@/messaging/client";
import c from "../components/controls.module.css";
import { EmptyState } from "../components/EmptyState";
import { showToast } from "../components/Toast";
import { rovingAction, useRoving } from "../hooks/useRoving";
import { IconPlus } from "../icons";
import { sanitizeQuickLinks, sanitizeRev } from "../sanitize";
import { store } from "../store";
import { Card, SaveError, type WidgetProps } from "./Card";
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

const fullCheck = (v: readonly QuickLink[]) =>
  sortLinks(v).length >= QUICKLINK_CAP ? t("dashLinksListFull", QUICKLINK_CAP) : null;

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
  /** The form's change is waiting for the worker (a second Save is ignored). */
  const saving = useRef(false);
  const [drag, setDrag] = useState<{ id: string; over: string | null } | null>(null);
  const roving = useRoving(links.length);
  const full = links.length >= QUICKLINK_CAP;
  const editing = form && form !== "new" ? links.find((x) => x.id === form) : undefined;

  /** Closes the form; focus goes to the edited tile, else the Add button (or the first tile). */
  const closeForm = (tileId?: string) => {
    setForm(null);
    setTimeout(() => {
      const root = document.querySelector<HTMLElement>('[data-widget="quicklinks"]');
      const tile = tileId
        ? root?.querySelector<HTMLElement>(`[data-link-id="${CSS.escape(tileId)}"]`)
        : null;
      const target =
        tile ??
        root?.querySelector<HTMLElement>("[data-add-link]") ??
        root?.querySelector<HTMLElement>('a[tabindex="0"]');
      target?.focus();
    });
  };

  const save = (url: string, title: string) => {
    if (saving.current || form === null) return;
    const isNew = form === "new";
    const id = isNew ? newId() : form;
    saving.current = true;
    void rec
      .apply((v) => (isNew ? addLink(v, { id, url, title }) : updateLink(v, id, { url, title })), {
        immediate: true,
        ...(isNew ? { check: fullCheck } : {}),
      })
      .then((written) => {
        saving.current = false;
        // Kept open (with what was typed) when the write failed and was discarded.
        if (written) closeForm(isNew ? undefined : id);
      });
  };

  const remove = (link: QuickLink, index: number) => {
    void rec.apply((v) => removeLink(v, link.id));
    showToast({
      message: t("dashLinkRemoved", link.title || link.url),
      duration: 8000,
      action: {
        label: t("undo"),
        run: () => void rec.apply((v) => reinsertLink(v, link, index)),
      },
    });
  };

  const addButton = !full && form === null && (
    <button
      type="button"
      class={`${c.btn} ${c.ghost}`}
      data-add-link
      onClick={() => setForm("new")}
      aria-label={t("dashLinkAdd")}
    >
      <IconPlus size={14} />
      {t("add")}
    </button>
  );

  return (
    <Card id="quicklinks" title={t("dashQuickLinks")} compact={compact} actions={addButton}>
      {form !== null && (
        <QuickLinkForm
          key={form}
          {...(editing ? { initial: { url: editing.url, title: editing.title } } : {})}
          onCancel={() => closeForm(form === "new" ? undefined : form)}
          onSave={save}
        />
      )}
      <SaveError text={rec.error} onRetry={rec.retry} onDiscard={rec.discard} />
      {links.length === 0 ? (
        form === null && (
          <EmptyState title={t("dashLinksEmpty")} hint={t("dashLinksEmptyHint")}>
            <button type="button" class={c.btn} data-add-link onClick={() => setForm("new")}>
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
              item={roving.item(i)}
              onNavKey={(key) => {
                const a = rovingAction(key, i, links.length, false);
                if (a?.kind !== "focus") return false;
                roving.focusAt(a.index);
                return true;
              }}
              first={i === 0}
              last={i === links.length - 1}
              dragOver={drag?.over === link.id && drag.id !== link.id}
              onEdit={() => setForm(link.id)}
              onRemove={() => remove(link, i)}
              onMove={(delta) => {
                void rec.apply((v) => moveLink(v, link.id, delta));
                setTimeout(() => roving.focusAt(i + delta));
              }}
              onDragStart={() => setDrag({ id: link.id, over: null })}
              onDragOver={() =>
                drag && drag.over !== link.id && setDrag({ ...drag, over: link.id })
              }
              onDrop={() => {
                const from = drag?.id;
                if (from && from !== link.id) void rec.apply((v) => moveLinkTo(v, from, link.id));
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
