import { afterEach, describe, expect, it, vi } from "vitest";
import { send, sendEnvelope, setTransport } from "./client";
import { RpcError } from "./errors";
import { createMessageListener } from "./server";

afterEach(() => setTransport(null));

describe("rpc client", () => {
  it("send resolves the value and throws RpcError on ok:false", async () => {
    setTransport(async (msg) =>
      msg.type === "system.ping"
        ? { ok: true, value: { epoch: "e", ready: true } }
        : { ok: false, code: "busy", message: "nope", retryable: true },
    );
    expect(await send("system.ping", {})).toEqual({ epoch: "e", ready: true });
    const err = await send("op.status", { windowId: 1 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RpcError);
    expect(err).toMatchObject({ code: "busy", retryable: true, message: "nope" });
  });

  it("retries once (same requestId) when the worker was asleep", async () => {
    const ids: string[] = [];
    let n = 0;
    setTransport(async (msg) => {
      ids.push(msg.requestId);
      if (++n === 1)
        throw new Error("Could not establish connection. Receiving end does not exist.");
      return { ok: true, value: null };
    });
    expect(await sendEnvelope("pomodoro.stop", {})).toEqual({ ok: true, value: null });
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(ids[1]);
  });

  it("maps a missing or odd response and transport errors to internal", async () => {
    setTransport(async () => undefined);
    expect(await sendEnvelope("pomodoro.stop", {})).toMatchObject({ ok: false, code: "internal" });
    setTransport(async () => {
      throw new Error("boom");
    });
    expect(await sendEnvelope("pomodoro.stop", {})).toMatchObject({
      ok: false,
      code: "internal",
      message: "boom",
    });
  });
});

describe("rpc server listener", () => {
  it("answers RPC requests asynchronously and ignores everything else", async () => {
    const dispatch = vi.fn(async () => ({ ok: true as const, value: 1 }));
    const listener = createMessageListener({ dispatch }, "ext");
    const sendResponse = vi.fn();
    expect(listener({ hello: 1 }, { id: "ext" }, sendResponse)).toBe(false);
    const msg = { kind: "tabitat.rpc", requestId: "r", type: "system.ping", payload: {} };
    expect(listener(msg, { id: "other" }, sendResponse)).toBe(false);
    expect(listener(msg, { id: "ext" }, sendResponse)).toBe(true);
    await new Promise((r) => setImmediate(r));
    expect(sendResponse).toHaveBeenCalledWith({ ok: true, value: 1 });
  });

  it("RpcError builds envelopes", () => {
    expect(new RpcError("not_found", "x").toEnvelope()).toEqual({
      ok: false,
      code: "not_found",
      message: "x",
      retryable: false,
    });
  });
});
