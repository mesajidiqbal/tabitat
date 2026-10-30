/** Localized bookmarks-import warnings: one line per warning code with its summed count. */
import { type MsgKey, t } from "@/i18n";
import { sumWarnings, WARNING_CODES, type WarningCode } from "./bookmarks-tree";

const KEYS: Record<WarningCode, MsgKey> = {
  unsupported: "optBmWarn_unsupported",
  duplicates: "optBmWarn_duplicates",
  entries_limit: "optBmWarn_entries_limit",
  quicklinks_limit: "optBmWarn_quicklinks_limit",
  links_limit: "optBmWarn_links_limit",
  workspaces_limit: "optBmWarn_workspaces_limit",
};

/** Lines for per-code counts (zero counts left out), in a stable order. */
export function countLines(counts: Partial<Record<WarningCode, number>>): string[] {
  return WARNING_CODES.flatMap((code) => {
    const n = counts[code] ?? 0;
    return n > 0 ? [t(KEYS[code], n)] : [];
  });
}

/** Lines for `<code>:<count>` warning lists (summed); unknown codes are shown as they are. */
export function warningLines(lists: readonly (readonly string[])[]): string[] {
  const { counts, other } = sumWarnings(lists);
  return [...countLines(counts), ...other];
}
