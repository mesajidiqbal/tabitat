/** Inline "new workspace" form: name, colour, "start empty" (default: from this window). */
import { useState } from "preact/hooks";
import type { Color } from "@/core/model/types";
import { t } from "@/i18n";
import { send } from "@/messaging/client";
import { errorText } from "../actions";
import { store } from "../store";
import { COLORS } from "../theme";
import { ColorSwatches } from "./ColorSwatches";
import c from "./controls.module.css";
import s from "./forms.module.css";

function nextColor(): Color {
  const used = new Set(Object.values(store.metas.peek()).map((m) => m.color));
  return COLORS.find((x) => x !== "grey" && !used.has(x)) ?? "blue";
}

export function WorkspaceForm({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [color, setColor] = useState<Color>(nextColor);
  const [empty, setEmpty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (e: Event) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed === "") return setError(t("errNameRequired"));
    const w = store.windowId.peek();
    setSaving(true);
    setError(null);
    try {
      await send("workspace.create", {
        name: trimmed,
        color,
        ...(empty || w === null ? {} : { fromWindowId: w }),
      });
      onClose();
    } catch (err) {
      setError(errorText(err));
      setSaving(false);
    }
  };

  return (
    <form
      class={s.form}
      aria-label={t("newWorkspace")}
      onSubmit={submit}
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.stopPropagation();
        onClose();
      }}
    >
      <input
        class={c.input}
        // biome-ignore lint/a11y/noAutofocus: the form is opened on purpose (n / + New)
        autoFocus
        aria-label={t("workspaceName")}
        placeholder={t("workspaceName")}
        maxLength={200}
        value={name}
        onInput={(e) => setName(e.currentTarget.value)}
      />
      <ColorSwatches value={color} onChange={setColor} />
      <div class={s.row}>
        <label class={s.check} title={t("startEmptyHint")}>
          <input
            type="checkbox"
            checked={empty}
            onChange={(e) => setEmpty(e.currentTarget.checked)}
          />
          {t("startEmpty")}
        </label>
        <div class={s.buttons}>
          <button type="button" class={c.btn} onClick={onClose}>
            {t("cancel")}
          </button>
          <button type="submit" class={`${c.btn} ${c.primary}`} disabled={saving}>
            {t("create")}
          </button>
        </div>
      </div>
      {error && (
        <p class={s.err} role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
