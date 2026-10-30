/**
 * Export actions shared by the recovery page, the options Data section and the backup banner:
 * each asks the worker for the file (`backup.export`, `backup.exportHtml`, `session.exportHtml`)
 * and hands it to the browser as a download. They throw an RpcError on failure; callers show it.
 */
import { signal } from "@preact/signals";
import { send } from "@/messaging/client";
import { dayStamp, downloadJson, downloadText } from "./download";

const STRIP_KEY = "tabitat:exportStripQuery";

/** JSON backup of everything (also records the backup time in the worker). */
export async function exportJsonBackup(): Promise<void> {
  const file = await send("backup.export", {});
  downloadJson(`tabitat-backup-${dayStamp(file.exportedAt)}.json`, file);
}

/** Bookmarks-HTML export of every workspace and the quick links. */
export async function exportHtmlBackup(stripQuery: boolean): Promise<void> {
  const out = await send("backup.exportHtml", { stripQuery });
  downloadText(out.filename, out.html, "text/html");
}

/** Bookmarks-HTML export of one session snapshot. */
export async function exportSessionHtml(generation: number, stripQuery: boolean): Promise<void> {
  const out = await send("session.exportHtml", { generation, stripQuery });
  downloadText(out.filename, out.html, "text/html");
}

const readStrip = (): boolean => {
  try {
    return localStorage.getItem(STRIP_KEY) === "1";
  } catch {
    return false;
  }
};

/** One shared value per page, so every "Strip query strings" checkbox stays in sync. */
const stripQuery = signal(readStrip());

/** The "Strip query strings" checkbox state, remembered in localStorage (default off). */
export function useStripQuery(): [boolean, (v: boolean) => void] {
  const set = (v: boolean) => {
    stripQuery.value = v;
    try {
      localStorage.setItem(STRIP_KEY, v ? "1" : "0");
    } catch {
      // storage unavailable: the choice lasts until the page closes
    }
  };
  return [stripQuery.value, set];
}
