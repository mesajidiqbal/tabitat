/** Preview line, Import button and "Remove bookmarks permission" of the bookmarks import. */
import { t } from "@/i18n";
import c from "../components/controls.module.css";
import type { Collected } from "./bookmarks-tree";
import s from "./options.module.css";

export interface ImportFooterProps {
  collected: Collected;
  /** Links the chosen destination cannot take. */
  overflow: number;
  canImport: boolean;
  busy: boolean;
  /** An import succeeded: offer to remove the permission. */
  imported: boolean;
  onImport: () => void;
  onRemovePermission: () => void;
}

export function ImportFooter(p: ImportFooterProps) {
  const { collected } = p;
  return (
    <>
      <p class={s.hint} aria-live="polite">
        {t("optBmPreview", [collected.links, collected.folders, collected.unsupported])}
        {p.overflow > 0 && ` ${t("optBmOverflow", p.overflow)}`}
        {collected.capped > 0 && ` ${t("optBmCapped", collected.entries.length)}`}
      </p>
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
