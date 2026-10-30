/**
 * UI side of the RPC (ADR-003). `send` resolves with the value or throws an RpcError;
 * `sendEnvelope` returns the raw envelope. Requests carry a requestId so a retry after a
 * dropped response is de-duplicated by the worker.
 */
import type { CommandIn, CommandOut, CommandType, Envelope, RpcRequest } from "./commands";
import { errorEnvelope, RpcError } from "./errors";

export type Transport = (msg: RpcRequest) => Promise<unknown>;

const chromeTransport: Transport = (msg) => chrome.runtime.sendMessage(msg);
let transport: Transport = chromeTransport;

/** For tests / non-extension contexts. Pass null to restore chrome.runtime.sendMessage. */
export function setTransport(t: Transport | null): void {
  transport = t ?? chromeTransport;
}

function newRequestId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

function isEnvelope(x: unknown): x is Envelope<unknown> {
  return typeof x === "object" && x !== null && typeof (x as { ok?: unknown }).ok === "boolean";
}

const NO_RECEIVER = /Receiving end does not exist|Could not establish connection/i;

export async function sendEnvelope<T extends CommandType>(
  type: T,
  payload: CommandIn<T>,
  opts: { requestId?: string; retries?: number } = {},
): Promise<Envelope<CommandOut<T>>> {
  const msg: RpcRequest<T> = {
    kind: "tabitat.rpc",
    requestId: opts.requestId ?? newRequestId(),
    type,
    payload,
  };
  let retries = opts.retries ?? 1;
  for (;;) {
    try {
      const res = await transport(msg as RpcRequest);
      if (isEnvelope(res)) return res as Envelope<CommandOut<T>>;
      return errorEnvelope("internal", "no response from the service worker");
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      // Spike S6: the message that hits a sleeping worker revives it; retry once (same requestId).
      if (retries > 0 && NO_RECEIVER.test(message)) {
        retries--;
        continue;
      }
      return errorEnvelope("internal", message);
    }
  }
}

export async function send<T extends CommandType>(
  type: T,
  payload: CommandIn<T>,
  opts: { requestId?: string; retries?: number } = {},
): Promise<CommandOut<T>> {
  const env = await sendEnvelope(type, payload, opts);
  if (env.ok) return env.value;
  throw new RpcError(env.code, env.message, env.retryable);
}
