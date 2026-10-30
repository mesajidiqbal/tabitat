/** `sync:status` (storage.local, written by the worker): defensive parse and error mapping. */
import type { MsgKey } from "@/i18n";
import type { SyncStatus } from "@/messaging/commands";

export const SYNC_STATUS_KEY = "sync:status";

const num = (x: unknown): number | undefined =>
  typeof x === "number" && Number.isFinite(x) ? x : undefined;

export function parseSyncStatus(raw: unknown): SyncStatus {
  if (typeof raw !== "object" || raw === null) return { enabled: false };
  const r = raw as Record<string, unknown>;
  const out: SyncStatus = { enabled: r.enabled === true };
  const push = num(r.lastPushAt);
  const pull = num(r.lastPullAt);
  if (push !== undefined) out.lastPushAt = push;
  if (pull !== undefined) out.lastPullAt = pull;
  if (typeof r.error === "string" && r.error !== "") out.error = r.error;
  return out;
}

const ERROR_KEYS: Record<string, MsgKey> = {
  too_large: "optSyncErrTooLarge",
  quota: "optSyncErrQuota",
  unavailable: "optSyncErrUnavailable",
  invalid_remote: "optSyncErrInvalidRemote",
};

/** Message key for a sync error code; unknown codes use the generic sentence. */
export function syncErrorKey(code: string): MsgKey {
  return Object.hasOwn(ERROR_KEYS, code) ? (ERROR_KEYS[code] as MsgKey) : "optSyncErrUnknown";
}
