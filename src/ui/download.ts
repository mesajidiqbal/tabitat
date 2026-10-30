/**
 * Browser download of generated text (blob object URL + anchor click; no `downloads`
 * permission, no network). The URL is revoked after the browser has had time to start the save.
 */
export function downloadText(filename: string, text: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Pretty-printed JSON download (backups, quarantine dumps). */
export function downloadJson(filename: string, data: unknown): void {
  downloadText(filename, JSON.stringify(data, null, 2), "application/json");
}

/** `YYYY-MM-DD` (UTC) of an epoch-ms value, for download names. */
export const dayStamp = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
