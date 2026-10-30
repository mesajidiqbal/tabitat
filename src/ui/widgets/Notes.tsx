/**
 * Notes widget (docs/PHASE4.md §4): scope switch, textarea with 500 ms autosave, conflict notice
 * that keeps the draft ("Changed elsewhere · Reload / Keep mine"), Preview (light markdown).
 */
import { useState } from "preact/hooks";
import type { Scope } from "@/core/model/types";
import { t } from "@/i18n";
import c from "../components/controls.module.css";
import { EmptyState } from "../components/EmptyState";
import { store } from "../store";
import { Card, ScopeSwitch, Skeleton, useScope, type WidgetProps } from "./Card";
import { MarkdownView } from "./MarkdownView";
import { useNoteDraft } from "./useNoteDraft";
import s from "./widgets.module.css";

export function Notes({ compact }: WidgetProps) {
  const sc = useScope();
  const [preview, setPreview] = useState(false);
  const loaded = sc.scope in store.notes.value;
  return (
    <Card
      id="notes"
      title={t("dashNotes")}
      compact={compact}
      actions={
        <>
          <ScopeSwitch {...sc} label={t("dashScopeLabel")} />
          <button
            type="button"
            class={`${c.btn} ${c.ghost}`}
            aria-pressed={preview}
            onClick={() => setPreview(!preview)}
          >
            {preview ? t("dashNoteEdit") : t("dashNotePreview")}
          </button>
        </>
      }
    >
      {loaded ? (
        <NoteEditor key={sc.scope} scope={sc.scope} preview={preview} />
      ) : (
        <Skeleton small />
      )}
    </Card>
  );
}

function NoteEditor({ scope, preview }: { scope: Scope; preview: boolean }) {
  const note = useNoteDraft(scope);
  return (
    <>
      {note.conflict && (
        <div class={s.notice} role="alert">
          <span>{t("dashNoteConflict")}</span>
          <button type="button" class={c.btn} onClick={() => void note.reload()}>
            {t("dashNoteReload")}
          </button>
          <button type="button" class={c.btn} onClick={() => void note.keepMine()}>
            {t("dashNoteKeepMine")}
          </button>
        </div>
      )}
      {preview ? (
        note.text.trim() === "" ? (
          <EmptyState title={t("dashNoteEmpty")} hint={t("dashNoteEmptyHint")} />
        ) : (
          <MarkdownView text={note.text} class={s.preview} />
        )
      ) : (
        <textarea
          class={s.textarea}
          aria-label={t("dashNotes")}
          placeholder={t("dashNotePlaceholder")}
          spellcheck
          value={note.text}
          onInput={(e) => note.onInput(e.currentTarget.value)}
        />
      )}
    </>
  );
}
