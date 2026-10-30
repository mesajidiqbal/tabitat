/** Inline add / edit form for a quick link: URL (scheme optional) and title (default: host). */
import { useState } from "preact/hooks";
import { t } from "@/i18n";
import c from "../components/controls.module.css";
import { defaultLinkTitle, normalizeLinkUrl } from "./quicklinks-logic";
import s from "./widgets.module.css";

export function QuickLinkForm(p: {
  initial?: { url: string; title: string };
  onSave: (url: string, title: string) => void;
  onCancel: () => void;
}) {
  const [url, setUrl] = useState(p.initial?.url ?? "");
  const [title, setTitle] = useState(p.initial?.title ?? "");
  const [error, setError] = useState<string | null>(null);
  const submit = (e: Event) => {
    e.preventDefault();
    const clean = normalizeLinkUrl(url);
    if (!clean) return setError(t("dashLinkInvalid"));
    p.onSave(clean, title.trim().slice(0, 500) || defaultLinkTitle(clean));
  };
  return (
    <form
      class={s.form}
      aria-label={p.initial ? t("dashLinkEdit") : t("dashLinkAdd")}
      onSubmit={submit}
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.stopPropagation();
        p.onCancel();
      }}
    >
      <input
        class={c.input}
        // biome-ignore lint/a11y/noAutofocus: the form was just opened
        autoFocus
        aria-label={t("dashLinkUrl")}
        placeholder={t("dashLinkUrlPlaceholder")}
        type="text"
        inputMode="url"
        spellcheck={false}
        maxLength={4000}
        value={url}
        onInput={(e) => {
          setUrl(e.currentTarget.value);
          setError(null);
        }}
      />
      <input
        class={c.input}
        aria-label={t("dashLinkTitle")}
        placeholder={t("dashLinkTitlePlaceholder")}
        maxLength={500}
        value={title}
        onInput={(e) => setTitle(e.currentTarget.value)}
      />
      {error && (
        <p class={s.err} role="alert">
          {error}
        </p>
      )}
      <div class={s.row}>
        <span class={s.grow} />
        <button type="button" class={c.btn} onClick={p.onCancel}>
          {t("cancel")}
        </button>
        <button type="submit" class={`${c.btn} ${c.primary}`}>
          {t("dashLinkSave")}
        </button>
      </div>
    </form>
  );
}
