import * as v from "valibot";
import { describe, expect, it, vi } from "vitest";
import { MigrationError } from "../core/model/migrations";
import { parseWorkspaceMeta } from "../core/model/schemas";
import { PlanError } from "../core/ops/switch-planner";
import { RpcError } from "../messaging/errors";
import { PayloadSchemas } from "../messaging/schemas";
import { CommandRouter, isRpcRequest } from "./command-router";
import { LaneQueue } from "./lanes";
import { testLogger } from "./testing/harness";

const deferred = () => {
  let resolve!: () => void;
  const p = new Promise<void>((r) => {
    resolve = r;
  });
  return { p, resolve };
};

function makeRouter(now = { t: 0 }, ready?: () => Promise<void>) {
  const lanes = new LaneQueue();
  const router = new CommandRouter({
    lanes,
    now: () => now.t,
    log: testLogger(),
    ...(ready ? { ready } : {}),
  });
  return { router, lanes, now };
}

let seq = 0;
const req = (type: string, payload: unknown, requestId = `r${++seq}`) => ({
  kind: "tabitat.rpc",
  requestId,
  type,
  payload,
});

describe("CommandRouter", () => {
  it("serializes handlers in the same lane, runs other lanes concurrently", async () => {
    const { router } = makeRouter();
    const events: string[] = [];
    const gates = new Map<string, ReturnType<typeof deferred>>();
    router.register(
      "op.status",
      PayloadSchemas["op.status"],
      async (p) => {
        const name = `w${p.windowId}`;
        events.push(`start ${name}`);
        const g = deferred();
        gates.set(name + events.length, g);
        await g.p;
        events.push(`end ${name}`);
        return null;
      },
      (p) => `window:${p.windowId === 3 ? 2 : p.windowId}`,
    );
    const a = router.dispatch(req("op.status", { windowId: 1 }));
    const b = router.dispatch(req("op.status", { windowId: 1 }));
    const c = router.dispatch(req("op.status", { windowId: 2 }));
    await new Promise((r) => setImmediate(r));
    expect(events).toEqual(["start w1", "start w2"]);
    for (const g of gates.values()) g.resolve();
    await new Promise((r) => setImmediate(r));
    expect(events.slice(0, 4)).toEqual(["start w1", "start w2", "end w1", "end w2"]);
    expect(events[4]).toBe("start w1");
    for (const g of gates.values()) g.resolve();
    expect((await a).ok && (await b).ok && (await c).ok).toBe(true);
  });

  it("de-duplicates a requestId for 30 s and returns the cached envelope", async () => {
    const { router, now } = makeRouter();
    const handler = vi.fn(async () => ({ epoch: "e", ready: true as const }));
    router.register("system.ping", PayloadSchemas["system.ping"], handler, () => []);
    const first = await router.dispatch(req("system.ping", {}, "same"));
    const again = await router.dispatch(req("system.ping", {}, "same"));
    expect(again).toBe(first);
    expect(handler).toHaveBeenCalledTimes(1);
    now.t += 30_001;
    await router.dispatch(req("system.ping", {}, "same"));
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("does not cache retryable failures (a retry with the same requestId runs again)", async () => {
    const { router } = makeRouter();
    let n = 0;
    router.register(
      "system.ping",
      PayloadSchemas["system.ping"],
      async () => {
        if (++n === 1) throw new Error("transient");
        return { epoch: "e", ready: true as const };
      },
      () => [],
    );
    expect(await router.dispatch(req("system.ping", {}, "x"))).toMatchObject({
      ok: false,
      code: "internal",
      retryable: true,
    });
    expect(await router.dispatch(req("system.ping", {}, "x"))).toMatchObject({ ok: true });
  });

  it("validation errors -> invalid", async () => {
    const { router } = makeRouter();
    const handler = vi.fn();
    router.register("workspace.switch", PayloadSchemas["workspace.switch"], handler, () => []);
    expect(
      await router.dispatch(req("workspace.switch", { windowId: "1", workspaceId: "a" })),
    ).toMatchObject({
      ok: false,
      code: "invalid",
      retryable: false,
    });
    expect(await router.dispatch(req("workspace.switch", { windowId: 1 }))).toMatchObject({
      code: "invalid",
    });
    expect(handler).not.toHaveBeenCalled();
    expect(await router.dispatch(req("nope.nope", {}))).toMatchObject({ code: "invalid" });
    expect(await router.dispatch({ type: "workspace.switch" })).toMatchObject({ code: "invalid" });
    expect(await router.dispatch(null)).toMatchObject({ code: "invalid" });
  });

  it("maps thrown errors to envelope codes", async () => {
    const { router } = makeRouter();
    const cases: Array<[unknown, string]> = [
      [new RpcError("busy", "b"), "busy"],
      [new RpcError("conflict", "c"), "conflict"],
      [new PlanError("same_workspace"), "invalid"],
      [
        (() => {
          try {
            parseWorkspaceMeta({});
          } catch (e) {
            return e;
          }
        })(),
        "invalid",
      ],
      [
        (() => {
          try {
            v.parse(v.string(), 1);
          } catch (e) {
            return e;
          }
        })(),
        "invalid",
      ],
      [new MigrationError("m"), "internal"],
      ["a string", "internal"],
    ];
    let i = 0;
    router.register(
      "op.status",
      PayloadSchemas["op.status"],
      async () => {
        throw cases[i]?.[0];
      },
      () => [],
    );
    for (; i < cases.length; i++) {
      const env = await router.dispatch(req("op.status", { windowId: 1 }));
      expect(env).toMatchObject({ ok: false, code: cases[i]?.[1] });
    }
  });

  it("exclusive keys reject a second request with busy", async () => {
    const { router } = makeRouter();
    const gate = deferred();
    router.register(
      "workspace.switch",
      PayloadSchemas["workspace.switch"],
      async () => {
        await gate.p;
        return { skipped: [] };
      },
      (p) => `window:${p.windowId}`,
      { exclusive: (p) => `switch:${p.windowId}` },
    );
    const first = router.dispatch(req("workspace.switch", { windowId: 1, workspaceId: "a" }));
    expect(
      await router.dispatch(req("workspace.switch", { windowId: 1, workspaceId: "b" })),
    ).toMatchObject({
      code: "busy",
      retryable: true,
    });
    const other = router.dispatch(req("workspace.switch", { windowId: 2, workspaceId: "b" }));
    gate.resolve();
    expect((await first).ok).toBe(true);
    expect((await other).ok).toBe(true);
    // released afterwards
    expect(
      (await router.dispatch(req("workspace.switch", { windowId: 1, workspaceId: "c" }))).ok,
    ).toBe(true);
  });

  it("waits for ready() and reports a failed init as internal", async () => {
    const gate = deferred();
    const { router } = makeRouter({ t: 0 }, () => gate.p);
    const handler = vi.fn(async () => ({ epoch: "e", ready: true as const }));
    router.register("system.ping", PayloadSchemas["system.ping"], handler, () => []);
    const p = router.dispatch(req("system.ping", {}));
    await new Promise((r) => setImmediate(r));
    expect(handler).not.toHaveBeenCalled();
    gate.resolve();
    expect((await p).ok).toBe(true);

    const failed = makeRouter({ t: 0 }, () => Promise.reject(new Error("init failed")));
    failed.router.register("system.ping", PayloadSchemas["system.ping"], handler, () => []);
    expect(await failed.router.dispatch(req("system.ping", {}))).toMatchObject({
      code: "internal",
    });
  });

  it("undefined results become null; registered() lists commands", async () => {
    const { router } = makeRouter();
    router.register(
      "pomodoro.stop",
      PayloadSchemas["pomodoro.stop"],
      async () => undefined as never,
      () => "x",
    );
    expect(await router.dispatch(req("pomodoro.stop", {}))).toEqual({ ok: true, value: null });
    expect(router.has("pomodoro.stop")).toBe(true);
    expect(router.registered()).toEqual(["pomodoro.stop"]);
    expect(isRpcRequest(req("a", {}, ""))).toBe(false);
  });
});

describe("LaneQueue", () => {
  it("the global lane waits for everything and everything waits for it", async () => {
    const lanes = new LaneQueue();
    const order: string[] = [];
    const g1 = deferred();
    const a = lanes.run(["a"], async () => {
      await g1.p;
      order.push("a");
    });
    const all = lanes.run(["*"], async () => {
      order.push("global");
    });
    const b = lanes.run(["b"], async () => {
      order.push("b");
    });
    expect(lanes.isBusy("a")).toBe(true);
    await new Promise((r) => setImmediate(r));
    expect(order).toEqual([]);
    g1.resolve();
    await Promise.all([a, all, b]);
    expect(order).toEqual(["a", "global", "b"]);
    await new Promise((r) => setImmediate(r));
    expect(lanes.isBusy("a")).toBe(false);
  });

  it("a failing task does not block the lane", async () => {
    const lanes = new LaneQueue();
    await expect(lanes.run(["x"], async () => Promise.reject(new Error("boom")))).rejects.toThrow(
      "boom",
    );
    expect(await lanes.run(["x"], async () => 42)).toBe(42);
    expect(await lanes.run([], async () => 7)).toBe(7);
  });
});
