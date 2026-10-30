/** Error lines for the options page: a localized sentence per RPC error code plus raw detail. */
import { RpcError } from "@/messaging/errors";
import { describeError } from "../errors";

export interface ErrorLine {
  text: string;
  detail: string;
}

export function errorLine(e: unknown): ErrorLine {
  if (e instanceof RpcError) return describeError(e.code, e.message);
  return describeError("internal", e instanceof Error ? e.message : String(e));
}

export const isConflict = (e: unknown): boolean => e instanceof RpcError && e.code === "conflict";
