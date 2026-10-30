/**
 * CommandRouter (ARCHITECTURE §5.1/§7, ADR-003): validates RPC payloads with valibot, serializes
 * handlers per lane, de-duplicates requestIds for 30 s and maps every failure to an Envelope.
 * `dispatch` never throws.
 */
import * as v from "valibot";
import { MigrationError } from "../core/model/migrations";
import { SchemaError } from "../core/model/schemas";
import { PlanError } from "../core/ops/switch-planner";
import type {
  CommandIn,
  CommandOut,
  CommandType,
  Envelope,
  RpcRequest,
} from "../messaging/commands";
import { errorEnvelope, RpcError } from "../messaging/errors";
import type { LaneQueue } from "./lanes";
import type { Logger } from "./repository";

export const DEDUP_MS = 30_000;

export interface HandlerContext {
  requestId: string;
}

export type Handler<T extends CommandType> = (
  payload: CommandIn<T>,
  ctx: HandlerContext,
) => Promise<CommandOut<T>>;

export interface RouteOptions<T extends CommandType> {
  /**
   * Requests whose key is already queued or running are rejected with `busy` instead of
   * queueing (invariant I5: one switch per window).
   */
  exclusive?: (payload: CommandIn<T>) => string;
}

interface Route {
  schema: v.GenericSchema;
  handler: (payload: unknown, ctx: HandlerContext) => Promise<unknown>;
  lanes: (payload: unknown) => string | readonly string[];
  exclusive?: (payload: unknown) => string;
}

export interface RouterOptions {
  lanes: LaneQueue;
  now: () => number;
  /** Awaited before any handler runs (init barrier). */
  ready?: () => Promise<void>;
  dedupMs?: number;
  log?: Logger;
}

export function isRpcRequest(msg: unknown): msg is RpcRequest {
  if (typeof msg !== "object" || msg === null) return false;
  const m = msg as Record<string, unknown>;
  return (
    m.kind === "tabitat.rpc" &&
    typeof m.requestId === "string" &&
    m.requestId !== "" &&
    typeof m.type === "string"
  );
}

/** Maps any thrown value to an error envelope. */
export function toErrorEnvelope(e: unknown, log: Logger = console): Envelope<never> {
  if (e instanceof RpcError) return e.toEnvelope();
  if (e instanceof PlanError) return errorEnvelope("invalid", e.message);
  if (e instanceof SchemaError) return errorEnvelope("invalid", e.message);
  if (e instanceof v.ValiError) return errorEnvelope("invalid", e.message);
  if (e instanceof MigrationError) return errorEnvelope("internal", e.message, false);
  log.error("[tabitat] command failed", e);
  return errorEnvelope("internal", e instanceof Error ? e.message : String(e));
}

export class CommandRouter {
  private readonly routes = new Map<string, Route>();
  private readonly dedup = new Map<string, { at: number; result: Promise<Envelope<unknown>> }>();
  private readonly exclusiveKeys = new Set<string>();
  private readonly dedupMs: number;
  private readonly log: Logger;

  constructor(private readonly opts: RouterOptions) {
    this.dedupMs = opts.dedupMs ?? DEDUP_MS;
    this.log = opts.log ?? console;
  }

  register<T extends CommandType>(
    type: T,
    schema: v.GenericSchema,
    handler: Handler<T>,
    lane: (payload: CommandIn<T>) => string | readonly string[],
    options: RouteOptions<T> = {},
  ): this {
    const route: Route = {
      schema,
      handler: handler as Route["handler"],
      lanes: lane as Route["lanes"],
    };
    if (options.exclusive) route.exclusive = options.exclusive as Route["exclusive"];
    this.routes.set(type, route);
    return this;
  }

  has(type: string): boolean {
    return this.routes.has(type);
  }

  registered(): string[] {
    return [...this.routes.keys()];
  }

  dispatch(msg: unknown): Promise<Envelope<unknown>> {
    try {
      if (!isRpcRequest(msg)) return Promise.resolve(errorEnvelope("invalid", "malformed request"));
      const now = this.opts.now();
      for (const [id, entry] of this.dedup) {
        if (now - entry.at > this.dedupMs) this.dedup.delete(id);
      }
      const cached = this.dedup.get(msg.requestId);
      if (cached) return cached.result;
      const result = this.execute(msg);
      this.dedup.set(msg.requestId, { at: now, result });
      void result.then((env) => {
        // Retryable failures must be retryable with the same requestId.
        if (!env.ok && env.retryable) this.dedup.delete(msg.requestId);
      });
      return result;
    } catch (e) {
      return Promise.resolve(toErrorEnvelope(e, this.log));
    }
  }

  private async execute(msg: RpcRequest): Promise<Envelope<unknown>> {
    const route = this.routes.get(msg.type);
    if (!route) return errorEnvelope("invalid", `unknown command "${msg.type}"`);
    const parsed = v.safeParse(route.schema, msg.payload ?? {});
    if (!parsed.success) {
      const issue = parsed.issues[0];
      const path = issue ? v.getDotPath(issue) : null;
      return errorEnvelope(
        "invalid",
        `${msg.type}: ${path ? `${path}: ` : ""}${issue?.message ?? "invalid payload"}`,
      );
    }
    const payload = parsed.output;
    let exclusiveKey: string | undefined;
    try {
      if (route.exclusive) {
        exclusiveKey = route.exclusive(payload);
        if (this.exclusiveKeys.has(exclusiveKey)) {
          exclusiveKey = undefined;
          return errorEnvelope("busy", `${msg.type}: another operation is in progress`);
        }
        this.exclusiveKeys.add(exclusiveKey);
      }
      if (this.opts.ready) await this.opts.ready();
      const lanes = route.lanes(payload);
      const value = await this.opts.lanes.run(typeof lanes === "string" ? [lanes] : lanes, () =>
        route.handler(payload, { requestId: msg.requestId }),
      );
      return { ok: true, value: value === undefined ? null : value };
    } catch (e) {
      return toErrorEnvelope(e, this.log);
    } finally {
      if (exclusiveKey !== undefined) this.exclusiveKeys.delete(exclusiveKey);
    }
  }
}
