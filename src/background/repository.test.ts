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
    const bad = "not a workspace meta"; // nothing to salvage
    fake.local.set(Keys.wsMeta("a"), bad);
    expect(await r.getWorkspaceMeta("a")).toBeNull();
    expect(fake.local.get(Keys.wsMeta("a"))).toBeUndefined();
    expect(fake.local.get("corrupt:ws:meta:a")).toMatchObject({ key: "ws:meta:a", raw: bad });
    expect(log.warnings.length).toBeGreaterThan(0);
    // a second corrupt copy does not overwrite the first
    fake.local.set(Keys.wsMeta("a"), 42);
    expect(await r.getWorkspaceMeta("a")).toBeNull();
    const keys = [...fake.local.keys()].filter((k) => k.startsWith("corrupt:ws:meta:a"));
    expect(keys).toHaveLength(2);
  });

  it("keeps the original when the quarantine copy cannot be written", async () => {
    const { fake, repo: r } = repo();
    fake.local.set(Keys.todos("x"), "nope");
    fake.failNext("storage.set");
    expect(await r.getTodos("x")).toBeNull();
    expect(fake.local.get(Keys.todos("x"))).toEqual("nope");
  });

  it("a meta with a missing id is repaired from its key, not quarantined (W)", async () => {
    const { fake, repo: r } = repo();
    const { id: _drop, ...noId } = meta("a");
    fake.local.set(Keys.wsMeta("a"), { ...noId, createdAt: 1.5 });
    expect(await r.getWorkspaceMeta("a")).toMatchObject({ id: "a", name: "a", createdAt: 1 });
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

  it("settings stored before the whitelist limits are cut to them, not quarantined", async () => {
    const { fake, repo: r } = repo();
    const whitelist = Array.from({ length: 250 }, (_, i) => `h${i}.example`);
    fake.local.set(Keys.settings, {
      ...DEFAULT_SETTINGS,
      theme: "dark",
      suspend: { enabled: true, afterMinutes: 30, whitelist },
      rev: 9,
    });
    const s = await r.getSettings();
    expect(s).toMatchObject({ theme: "dark", rev: 9, suspend: { enabled: true } });
    expect(s.suspend.whitelist).toEqual(whitelist.slice(0, 200));
    expect((fake.local.get(Keys.settings) as typeof s).suspend.whitelist).toHaveLength(200);
    expect(fake.local.get("corrupt:settings")).toMatchObject({
      key: Keys.settings,
      raw: whitelist.slice(200),
      salvaged: true,
    });
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

  it("ws:tabs: one bad tab is quarantined, the other tabs stay (K)", async () => {
    const { fake, repo: r } = repo();
    const good = (id: string, i: number) => ({
      id,
      url: `https://${id}.example/`,
      title: id,
      index: i,
    });
    fake.local.set(Keys.wsTabs("a"), {
      tabs: [
        good("t1", 0),
        { ...good("t2", 1), url: "javascript:alert(1)" },
        { ...good("t3", 2), favIconUrl: "data:image/png;base64,AA" },
        { ...good("t1", 3), url: "https://dup.example/" },
      ],
      activeSavedTabId: "t3",
      updatedAt: 5,
      rev: 4,
    });
    const tabs = await r.getWorkspaceTabs("a");
    expect(tabs?.tabs.map((t) => t.url)).toEqual([
      "https://t1.example/",
      "https://t3.example/",
      "https://dup.example/",
    ]);
    expect(new Set(tabs?.tabs.map((t) => t.id)).size).toBe(3); // duplicate id re-assigned
    expect(tabs?.tabs[1]?.favIconUrl).toBeUndefined();
    expect(tabs?.activeSavedTabId).toBe("t3");
    expect(tabs?.rev).toBe(5);
    // written back in the same set as the corrupt copy of the dropped entry only
    expect(fake.local.get(Keys.wsTabs("a"))).toEqual(tabs);
    expect(fake.local.get("corrupt:ws:tabs:a")).toMatchObject({
      key: "ws:tabs:a",
      raw: [{ id: "t2", url: "javascript:alert(1)" }],
      salvaged: true,
    });
  });

  it("salvage never removes the key before the salvaged value is written", async () => {
    const { fake, repo: r } = repo();
    const raw = {
      tabs: [{ id: "x", url: "javascript:x", title: "", index: 0 }],
      updatedAt: 1,
      rev: 0,
    };
    fake.local.set(Keys.wsTabs("a"), raw);
    fake.failNext("storage.set");
    expect((await r.getWorkspaceTabs("a"))?.tabs).toEqual([]);
    expect(fake.local.get(Keys.wsTabs("a"))).toEqual(raw); // untouched: nothing removed
    expect(fake.calls).not.toContain("storage.remove");
  });

  it("per-item salvage of index, recently closed, trash, todos, quick links, meta links", async () => {
    const { fake, repo: r } = repo();
    fake.local.set(Keys.wsMeta("a"), {
      ...meta("a"),
      color: "chartreuse",
      resources: [{ id: "l", url: "blob:x", title: "", order: 0, addedAt: 1 }],
    });
    fake.local.set(Keys.wsMeta("b"), meta("b"));
    fake.local.set(Keys.wsIndex, ["a", "a", "bad id", 7]);
    expect(await r.getWorkspaceIndex()).toEqual(["a", "b"]);
    expect(await r.getWorkspaceMeta("a")).toMatchObject({ id: "a", color: "grey", resources: [] });
    fake.local.set(Keys.recentlyClosed, [
      { id: "c1", url: "https://a.example/", title: "", closedAt: 1, favIconUrl: "blob:x" },
      { id: "c2", url: "blob:https://x/", title: "", closedAt: 1 },
    ]);
    expect((await r.getRecentlyClosed()).map((c) => [c.id, c.favIconUrl])).toEqual([
      ["c1", undefined],
    ]);
    fake.local.set(Keys.todos("global"), {
      items: [{ id: "t", text: "x", done: false, order: 0, createdAt: 1 }, { nope: 1 }],
      rev: 2,
    });
    expect((await r.getTodos("global"))?.items.map((t) => t.id)).toEqual(["t"]);
    fake.local.set(Keys.quicklinks, {
      items: [
        { id: "q", url: "https://q/", title: "", order: 0 },
        { id: "z", url: "javascript:x", title: "", order: 1 },
      ],
      rev: 1,
    });
    expect((await r.getQuickLinks()).items.map((q) => q.id)).toEqual(["q"]);
    fake.local.set(Keys.trash, {
      items: [
        {
          id: "w",
          kind: "workspace",
          deletedAt: 1,
          meta: meta("w"),
          tabs: {
            tabs: [{ id: "x", url: "javascript:x", title: "", index: 0 }],
            updatedAt: 1,
            rev: 0,
          },
        },
        { id: "junk", kind: "nope" },
      ],
    });
    const trash = await r.getTrash();
    expect(trash.items.map((i) => i.id)).toEqual(["w"]);
    // non-salvageable containers are still quarantined whole
    fake.local.set(Keys.todos("x"), "garbage");
    expect(await r.getTodos("x")).toBeNull();
    expect(fake.local.get(Keys.todos("x"))).toBeUndefined();
  });
});
