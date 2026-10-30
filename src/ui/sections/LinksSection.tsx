/** SAVED LINKS of the active workspace: open as tab, remove (undo toast), add form. */
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
import s from "./sections.module.css";

function LinkForm({ workspaceId, onClose }: { workspaceId: string; onClose: () => void }) {
  const tab = store.liveTabs.peek().find((x) => x.active);
  const web = tab && /^(https?|file|ftp):/.test(tab.url);
  const [url, setUrl] = useState(web ? tab.url : "");
  const [title, setTitle] = useState(web ? tab.title : "");
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: Event) => {
    e.preventDefault();
    try {
      await send("link.add", { workspaceId, url: url.trim(), title: title.trim() || url.trim() });
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
        onInput={(e) => setUrl(e.currentTarget.value)}
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
      {error && (
        <p class={f.err} role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

export function LinksSection(p: { variant: "popup" | "panel" }) {
  const meta = activeMeta.value;
  const [adding, setAdding] = useState(false);
  const links = meta ? [...meta.resources].sort((a, b) => a.order - b.order) : [];
  const roving = useRoving(links.length);
  if (!meta) return null;
  return (
    <section class={s.section} aria-labelledby="links-h">
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
      {adding && <LinkForm workspaceId={meta.id} onClose={() => setAdding(false)} />}
      {links.length === 0 && !adding && <p class={s.more}>{t("noLinksHint")}</p>}
      {links.length > 0 && (
        <div role="listbox" aria-labelledby="links-h" class={r.list}>
          {links.map((l, i) => (
            <TabRow
              key={l.id}
              title={l.title}
              url={l.url}
              item={roving.item(i)}
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
