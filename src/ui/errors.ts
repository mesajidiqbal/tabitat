/**
 * Localized text for worker errors. The worker's Envelope messages are English diagnostics; the
 * UI shows a localized sentence per error code and keeps the raw message as secondary detail.
 */
import { type MsgKey, t } from "@/i18n";
import type { RpcErrorCode } from "@/messaging/commands";

export interface ErrorDescription {
  /** Localized sentence for the error code. */
  text: string;
  /** The raw (worker / browser) message, for a tooltip or a details line. */
  detail: string;
}

const KEYS: Record<RpcErrorCode, MsgKey> = {
  conflict: "err_conflict",
  busy: "err_busy",
  not_found: "err_not_found",
  invalid: "err_invalid",
  limit: "err_limit",
  internal: "err_internal",
};

/** Unknown codes are described as `internal`. */
export function describeError(code: RpcErrorCode | string, message: string): ErrorDescription {
  const key = Object.hasOwn(KEYS, code) ? KEYS[code as RpcErrorCode] : KEYS.internal;
  return { text: t(key), detail: message };
}
