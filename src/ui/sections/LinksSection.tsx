/**
 * SAVED LINKS of the active workspace: open as tab, remove (undo toast), add form ("Already
 * saved" when the normalized URL exists). Drop zone for dragged tab rows (= park, like `p`).
 */
import { useState } from "preact/hooks";
import { t } from "@/i18n";
import { send } from "@/messaging/client";
import { errorText, openUrl, removeLink } from "../actions";
import c from "../components/controls.module.css";
import f from "../components/forms.module.css";
import r from "../components/rows.module.css";
import { SectionHeader } from "../components/SectionHeader";
import { TabRow } from "../components/TabRow";
import { useRoving } from "../hooks/useRoving";
import { IconClose, IconPlus } from "../icons";
import { activeMeta, store } from "../store";
import { isSavedLink, parkTab, TAB_DRAG_TYPE } from "../tabActions";
import s from "./sections.module.css";

function LinkForm({ workspaceId, onClose }: { workspaceId: string; onClose: () => void }) {
  const tab = store.liveTabs.peek().find((x) => x.active);
  const web = tab && /^(https?|file|ftp):/.test(tab.url);
  const [url, setUrl] = useState(web ? tab.url : "");
  const [title, setTitle] = useState(web ? tab.title : "");
  const [error, setError] = useState<string | null>(null);
  const [dup, setDup] = useState(false);
  const submit = async (e: Event) => {
    e.preventDefault();
    const u = url.trim();
    if (isSavedLink(workspaceId, u)) return setDup(true);
    try {
      await send("link.add", { workspaceId, url: u, title: title.trim() || u });
      onClose();
    } catch (err) {
      setError(errorText(err));
    }
  };
  return (
    <form
      class={f.form}
      aria-label={t("addLink")}
      onSubmit={submit}
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.stopPropagation();
        onClose();
      }}
    >
      <input
        class={c.input}
        // biome-ignore lint/a11y/noAutofocus: the form was just opened on purpose
        autoFocus
        type="url"
        required
        aria-label={t("linkUrl")}
        placeholder="https://"
        value={url}
        onInput={(e) => {
          setUrl(e.currentTarget.value);
          setDup(false);
        }}
      />
      <input
        class={c.input}
        aria-label={t("linkTitle")}
        placeholder={t("linkTitle")}
        maxLength={2000}
        value={title}
        onInput={(e) => setTitle(e.currentTarget.value)}
      />
      <div class={f.buttons}>
        <button type="button" class={c.btn} onClick={onClose}>
          {t("cancel")}
        </button>
        <button type="submit" class={`${c.btn} ${c.primary}`}>
          {t("add")}
        </button>
      </div>
      {dup && (
        <p class={s.notice} role="status">
          {t("alreadySaved")}
        </p>
      )}
      {error && (
        <p class={f.err} role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

const draggingTab = (e: DragEvent) => e.dataTransfer?.types.includes(TAB_DRAG_TYPE) === true;

export function LinksSection(p: { variant: "popup" | "panel" }) {
  const meta = activeMeta.value;
  const [adding, setAdding] = useState(false);
  const [over, setOver] = useState(false);
  const links = meta ? [...meta.resources].sort((a, b) => a.order - b.order) : [];
  const roving = useRoving(links.length);
  if (!meta) return null;
  const onDragOver = (e: DragEvent) => {
    if (!draggingTab(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    if (!over) setOver(true);
  };
  const onDragLeave = (e: DragEvent) => {
    const to = e.relatedTarget as Node | null;
    if (!to || !(e.currentTarget as HTMLElement).contains(to)) setOver(false);
  };
  const onDrop = (e: DragEvent) => {
    if (!draggingTab(e)) return;
    e.preventDefault();
    setOver(false);
    const id = Number(e.dataTransfer?.getData(TAB_DRAG_TYPE));
    if (Number.isInteger(id) && id >= 0) void parkTab(id, meta.id);
  };
  return (
    <section
      class={`${s.section} ${over ? s.dropZone : ""}`}
      aria-labelledby="links-h"
      onDragOver={onDragOver}
      onDragEnter={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <SectionHeader
        id="links-h"
        title={t("savedLinks")}
        count={links.length}
        sticky={p.variant === "panel"}
      >
        <button
          type="button"
          class={`${c.btn} ${c.ghost} ${s.addBtn}`}
          aria-expanded={adding}
          onClick={() => setAdding(!adding)}
        >
          <IconPlus size={14} />
          {t("add")}
        </button>
      </SectionHeader>
      {over && <p class={s.dropHint}>{t("dropToSave")}</p>}
      {adding && <LinkForm key={meta.id} workspaceId={meta.id} onClose={() => setAdding(false)} />}
      {links.length === 0 && !adding && !over && <p class={s.more}>{t("noLinksHint")}</p>}
      {links.length > 0 && (
        // biome-ignore lint/a11y/useSemanticElements: ARIA grid of div rows (flex rows / cards; no table elements)
        <div role="grid" aria-labelledby="links-h" aria-rowcount={links.length} class={r.list}>
          {links.map((l, i) => (
            <TabRow
              key={l.id}
              title={l.title}
              url={l.url}
              item={roving.item(i)}
              rowIndex={i + 1}
              showHost={p.variant === "panel"}
              onOpen={() => void openUrl(l.url)}
              actions={[
                {
                  label: t("removeLink"),
                  icon: <IconClose size={14} />,
                  del: true,
                  run: () => void removeLink(meta.id, l.id, l.title || l.url),
                },
              ]}
            />
          ))}
        </div>
      )}
    </section>
  );
}
