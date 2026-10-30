/** Preview lines, Import button and "Remove bookmarks permission" of the bookmarks import. */
import { t } from "@/i18n";
import c from "../components/controls.module.css";
import type { Collected, ImportPreview } from "./bookmarks-tree";
import { countLines } from "./bookmarks-warnings";
import s from "./options.module.css";

export interface ImportFooterProps {
  collected: Collected;
  /** The worker planner's result for the current selection and destination. */
  preview: ImportPreview;
  /** Entries whose folder path was shortened to fit the import limits. */
  shortened: number;
  canImport: boolean;
  busy: boolean;
  /** An import succeeded: offer to remove the permission. */
  imported: boolean;
  onImport: () => void;
  onRemovePermission: () => void;
}

export function ImportFooter(p: ImportFooterProps) {
  const { collected, preview } = p;
  const notes = [
    ...countLines(preview.counts),
    ...(p.shortened > 0 ? [t("optBmShortened", p.shortened)] : []),
  ];
  return (
    <>
      <div aria-live="polite">
        <p class={s.hint}>
          {t("optBmPreview", [collected.links, collected.folders, collected.unsupported])}
          {collected.capped > 0 && ` ${t("optBmCapped", collected.entries.length)}`}
        </p>
        {collected.entries.length > 0 && (
          <p class={s.hint}>{t("optBmPlan", [preview.added, preview.skipped])}</p>
        )}
        {collected.entries.length > 0 && notes.length > 0 && (
          <ul class={s.hint}>
            {notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        )}
      </div>
      <div class={s.row}>
        <button
          type="button"
          class={`${c.btn} ${c.primary}`}
          disabled={!p.canImport}
          onClick={p.onImport}
        >
          {p.busy ? t("optBmImporting") : t("optBmImport")}
        </button>
        {p.imported && (
          <button type="button" class={c.link} onClick={p.onRemovePermission}>
            {t("optBmRemovePerm")}
          </button>
        )}
      </div>
    </>
  );
}
