import type { Envelope, RpcErrorCode } from "./commands";

const RETRYABLE: Record<RpcErrorCode, boolean> = {
  conflict: true,
  busy: true,
  not_found: false,
  invalid: false,
  limit: false,
  internal: true,
};

/**
 * Error carrying an RPC envelope code. Thrown by worker handlers (mapped to an envelope by the
 * CommandRouter) and by the UI client `send()` when the envelope is `ok:false`.
 */
export class RpcError extends Error {
  override readonly name = "RpcError";
  readonly retryable: boolean;
  constructor(
    readonly code: RpcErrorCode,
    message: string,
    retryable?: boolean,
    /** Optional structured detail (e.g. a partially applied import's keys). */
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.retryable = retryable ?? RETRYABLE[code];
  }

  toEnvelope(): Envelope<never> {
    const env: Envelope<never> = {
      ok: false,
      code: this.code,
      message: this.message,
      retryable: this.retryable,
    };
    if (this.details) env.details = this.details;
    return env;
  }
}

export function errorEnvelope(
  code: RpcErrorCode,
  message: string,
  retryable = RETRYABLE[code],
): Envelope<never> {
  return { ok: false, code, message, retryable };
}
