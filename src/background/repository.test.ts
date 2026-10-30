import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, Keys } from "../core/model/types";
import { FakeBrowser } from "../platform/fake";
import { Repository } from "./repository";
import { testLogger } from "./testing/harness";

function repo() {
  const fake = new FakeBrowser();
  const ports = fake.ports();
  const log = testLogger();
  return { fake, repo: new Repository(ports.local, ports.now, log), log };
}

const meta = (id: string) => ({
  id,
  name: id,
  color: "blue",
  kind: "named",
  resources: [],
  createdAt: 1,
  updatedAt: 1,
  rev: 1,
});

describe("Repository", () => {
  it("returns typed records and null for missing ones", async () => {
    const { fake, repo: r } = repo();
    fake.local.set(Keys.wsMeta("a"), meta("a"));
    fake.local.set(Keys.wsIndex, ["a"]);
    expect((await r.getWorkspaceMeta("a"))?.name).toBe("a");
    expect(await r.getWorkspaceMeta("b")).toBeNull();
    expect(await r.getWorkspace("a")).toMatchObject({ meta: { id: "a" }, tabs: { tabs: [] } });
    expect((await r.listWorkspaces()).map((w) => w.meta.id)).toEqual(["a"]);
    expect(await r.getSettings()).toEqual(DEFAULT_SETTINGS);
    expect(await r.getTrash()).toEqual({ items: [] });
    expect(await r.getQuickLinks()).toEqual({ items: [], rev: 0 });
    expect(await r.getRecoveryPending()).toEqual({ entries: [] });
    expect(await r.getPomodoro()).toBeNull();
  });

  it("quarantines a corrupt record under corrupt:<key> instead of throwing", async () => {
    const { fake, repo: r, log } = repo();
    const bad = { ...meta("a"), color: "chartreuse" };
    fake.local.set(Keys.wsMeta("a"), bad);
    expect(await r.getWorkspaceMeta("a")).toBeNull();
    expect(fake.local.get(Keys.wsMeta("a"))).toBeUndefined();
    expect(fake.local.get("corrupt:ws:meta:a")).toMatchObject({ key: "ws:meta:a", raw: bad });
    expect(log.warnings.length).toBeGreaterThan(0);
    // a second corrupt copy does not overwrite the first
    fake.local.set(Keys.wsMeta("a"), { broken: true });
    expect(await r.getWorkspaceMeta("a")).toBeNull();
    const keys = [...fake.local.keys()].filter((k) => k.startsWith("corrupt:ws:meta:a"));
    expect(keys).toHaveLength(2);
  });

  it("keeps the original when the quarantine copy cannot be written", async () => {
    const { fake, repo: r } = repo();
    fake.local.set(Keys.wsTabs("a"), { tabs: "nope" });
    fake.failNext("storage.set");
    expect(await r.getWorkspaceTabs("a")).toBeNull();
    expect(fake.local.get(Keys.wsTabs("a"))).toEqual({ tabs: "nope" });
  });

  it("rebuilds a corrupt workspace index from surviving ids and ws:meta keys", async () => {
    const { fake, repo: r } = repo();
    fake.local.set(Keys.wsMeta("a"), meta("a"));
    fake.local.set(Keys.wsMeta("b"), meta("b"));
    fake.local.set(Keys.wsIndex, ["b", 42, ""]);
    expect(await r.getWorkspaceIndex()).toEqual(["b", "a"]);
    expect(fake.local.get(Keys.wsIndex)).toEqual(["b", "a"]);
    expect(fake.local.get("corrupt:ws:index")).toBeDefined();
  });

  it("salvages valid entries of recentlyClosed and sessions:index", async () => {
    const { fake, repo: r } = repo();
    const good = { id: "x", url: "https://x.example/", title: "x", closedAt: 1 };
    fake.local.set(Keys.recentlyClosed, [good, { id: 1 }]);
    expect(await r.getRecentlyClosed()).toEqual([good]);
    expect(fake.local.get(Keys.recentlyClosed)).toEqual([good]);
    fake.local.set(Keys.sessionsIndex, [3, 1, 1, "x"]);
    expect(await r.getSessionsIndex()).toEqual([1, 3]);
  });

  it("settings fall back to defaults when corrupt; window states and ops list skip bad rows", async () => {
    const { fake, repo: r } = repo();
    fake.local.set(Keys.settings, { theme: "neon" });
    expect(await r.getSettings()).toEqual(DEFAULT_SETTINGS);
    fake.local.set(Keys.window(1), { activeWorkspaceId: null, sessionEpoch: "e" });
    fake.local.set(Keys.window(2), { nope: true });
    fake.local.set("windows:abc", { activeWorkspaceId: null, sessionEpoch: "e" });
    expect([...(await r.listWindowStates()).keys()]).toEqual([1]);
    fake.local.set(Keys.opSwitch(1), { bad: true });
    expect(await r.listOps()).toEqual([]);
    expect(fake.local.get("corrupt:op:switch:1")).toBeDefined();
  });
});
