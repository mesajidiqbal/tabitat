import { describe, expect, it } from "vitest";
import type { Settings } from "../core/model/types";
import { DEFAULT_SETTINGS, Keys } from "../core/model/types";
import type { SyncStatus } from "../messaging/commands";
import type { FakeBrowser } from "../platform/fake";
import { BgKeys } from "./keys";
import { settle, setup, stored } from "./testing/harness";

const remote = (f: FakeBrowser) => f.sync.get("settings") as Record<string, unknown> | undefined;
const status = (f: FakeBrowser) => stored<SyncStatus>(f, BgKeys.syncStatus);
const local = (f: FakeBrowser) => stored<Settings>(f, Keys.settings) as Settings;
const syncSets = (f: FakeBrowser) => f.calls.filter((c) => c === "sync.set").length;

/** A remote copy as another device would push it (no rev). */
function remoteCopy(over: Partial<Settings>): Record<string, unknown> {
  const { rev: _rev, ...rest } = { ...structuredClone(DEFAULT_SETTINGS), syncSettings: true };
  return { ...rest, ...over };
}

describe("settings sync: push", () => {
  it("every settings.update sets updatedAt; nothing is pushed while sync is off", async () => {
    const h = await setup();
    const s = await h.ok("settings.update", { patch: { theme: "dark" } });
    expect(s.updatedAt).toBe(h.fake.clock);
    expect(h.fake.sync.size).toBe(0);
    expect(syncSets(h.fake)).toBe(0);
    expect(status(h.fake)).toBeUndefined();
  });

  it("pushes the settings without rev when sync is on", async () => {
    const h = await setup();
    const on = await h.ok("settings.update", { patch: { syncSettings: true } });
    expect(remote(h.fake)).toEqual(
      (({ rev: _r, ...rest }) => rest)(JSON.parse(JSON.stringify(on)) as Settings),
    );
    expect(remote(h.fake)).not.toHaveProperty("rev");
    expect(status(h.fake)).toEqual({ enabled: true, lastPushAt: h.fake.clock });
    h.fake.advance(1000);
    await h.ok("settings.update", { patch: { theme: "light" } });
    expect(remote(h.fake)).toMatchObject({ theme: "light", updatedAt: h.fake.clock });
  });

  it("size guard: a payload over QUOTA_BYTES_PER_ITEM is not written (too_large)", async () => {
    const h = await setup();
    await h.ok("settings.update", { patch: { syncSettings: true } });
    const before = syncSets(h.fake);
    const whitelist = Array.from({ length: 400 }, (_, i) => `host-${i}-long-name.example.com`);
    const s = await h.ok("settings.update", {
      patch: { suspend: { whitelist } as never },
    });
    expect(s.suspend.whitelist).toHaveLength(400); // local kept
    expect(syncSets(h.fake)).toBe(before);
    expect(status(h.fake)).toMatchObject({ enabled: true, error: "too_large" });
    expect(remote(h.fake)?.suspend).toMatchObject({ whitelist: [] });
  });

  it("write errors: QUOTA_BYTES -> quota, others -> unavailable, no sync area -> unavailable", async () => {
    const h = await setup();
    await h.ok("settings.update", { patch: { syncSettings: true } });
    const pushedAt = h.fake.clock;
    h.fake.failNext("sync.set", { error: new Error("QUOTA_BYTES quota exceeded") });
    h.fake.advance(10);
    await h.ok("settings.update", { patch: { theme: "dark" } });
    expect(status(h.fake)).toEqual({ enabled: true, lastPushAt: pushedAt, error: "quota" });
    expect(local(h.fake).theme).toBe("dark");
    h.fake.failNext("sync.set", { error: new Error("boom") });
    await h.ok("settings.update", { patch: { theme: "light" } });
    expect(status(h.fake)?.error).toBe("unavailable");
    h.fake.syncAvailable = false;
    await h.ok("settings.update", { patch: { theme: "dark" } });
    expect(status(h.fake)?.error).toBe("unavailable");
    h.fake.syncAvailable = true;
    h.fake.advance(10);
    await h.ok("settings.update", { patch: { theme: "system" } });
    expect(status(h.fake)).toEqual({ enabled: true, lastPushAt: h.fake.clock });
  });

  it("an image wallpaper is never pushed", async () => {
    const h = await setup();
    await h.ok("settings.update", {
      patch: {
        syncSettings: true,
        dashboard: { wallpaper: { kind: "image", value: "idb:wall" } } as never,
      },
    });
    const dash = remote(h.fake)?.dashboard as Record<string, unknown>;
    expect(dash).toBeDefined();
    expect(dash).not.toHaveProperty("wallpaper");
    expect(dash.widgets).toEqual(DEFAULT_SETTINGS.dashboard.widgets);
  });

  it("turning sync off records { enabled: false } and leaves the remote copy", async () => {
    const h = await setup();
    await h.ok("settings.update", { patch: { syncSettings: true } });
    const copy = remote(h.fake);
    const before = syncSets(h.fake);
    await h.ok("settings.update", { patch: { syncSettings: false } });
    expect(status(h.fake)).toEqual({ enabled: false });
    expect(remote(h.fake)).toEqual(copy);
    expect(syncSets(h.fake)).toBe(before);
  });
});

describe("settings sync: pull", () => {
  it("a newer remote copy is applied with the remote updatedAt and rev + 1, and not pushed back", async () => {
    const h = await setup();
    const on = await h.ok("settings.update", { patch: { syncSettings: true } });
    const pushes = syncSets(h.fake);
    h.fake.advance(5000);
    const at = h.fake.clock - 1000; // other device's clock; still newer than ours
    h.fake.remoteSyncChange("settings", remoteCopy({ theme: "dark", updatedAt: at }));
    await settle();
    const s = local(h.fake);
    expect(s).toMatchObject({ theme: "dark", updatedAt: at, rev: on.rev + 1, syncSettings: true });
    expect(syncSets(h.fake)).toBe(pushes); // no bounce
    expect(status(h.fake)).toMatchObject({ enabled: true, lastPullAt: h.fake.clock });
    expect(remote(h.fake)).toMatchObject({ theme: "dark", updatedAt: at });
  });

  it("an older (or equal) remote copy is ignored; our own push echo is ignored", async () => {
    const h = await setup();
    const on = await h.ok("settings.update", { patch: { syncSettings: true, theme: "light" } });
    await settle(); // echo of our own push
    expect(local(h.fake).rev).toBe(on.rev);
    h.fake.remoteSyncChange(
      "settings",
      remoteCopy({ theme: "dark", updatedAt: (on.updatedAt as number) - 1 }),
    );
    await settle();
    expect(local(h.fake)).toMatchObject({ theme: "light", rev: on.rev });
    expect(status(h.fake)?.lastPullAt).toBeUndefined();
  });

  it("an invalid remote copy keeps local and records invalid_remote", async () => {
    const h = await setup();
    const on = await h.ok("settings.update", { patch: { syncSettings: true } });
    h.fake.remoteSyncChange("settings", { theme: 42, updatedAt: h.fake.clock + 10_000 });
    await settle();
    expect(local(h.fake)).toEqual(on);
    expect(status(h.fake)).toMatchObject({ enabled: true, error: "invalid_remote" });
    // syncNow overwrites the bad copy with ours and clears the error
    const st = await h.ok("settings.syncNow", {});
    expect(st.error).toBeUndefined();
    expect(remote(h.fake)).toMatchObject({ updatedAt: on.updatedAt });
  });

  it("remote changes are ignored while sync is off", async () => {
    const h = await setup();
    h.fake.remoteSyncChange("settings", remoteCopy({ theme: "dark", updatedAt: h.fake.clock }));
    await settle();
    expect(local(h.fake).theme).toBe("system");
    expect(status(h.fake)).toBeUndefined();
  });

  it("keeps the local wallpaper when the remote has none, or when the local one is an image", async () => {
    const h = await setup();
    await h.ok("settings.update", {
      patch: { syncSettings: true, dashboard: { wallpaper: { kind: "color", value: "#123" } } },
    } as never);
    const noWall = remoteCopy({ theme: "dark", updatedAt: h.fake.clock + 1 });
    delete (noWall.dashboard as Record<string, unknown>).wallpaper;
    h.fake.remoteSyncChange("settings", noWall);
    await settle();
    expect(local(h.fake).theme).toBe("dark");
    expect(local(h.fake).dashboard.wallpaper).toEqual({ kind: "color", value: "#123" });

    h.fake.remoteSyncChange(
      "settings",
      remoteCopy({
        dashboard: { widgets: ["clock"], wallpaper: { kind: "gradient", value: "dusk" } },
        updatedAt: h.fake.clock + 2,
      }),
    );
    await settle();
    expect(local(h.fake).dashboard).toEqual({
      widgets: ["clock"],
      wallpaper: { kind: "gradient", value: "dusk" },
    });

    h.fake.advance(100);
    await h.ok("settings.update", {
      patch: { dashboard: { wallpaper: { kind: "image", value: "idb:x" } } as never },
    });
    h.fake.remoteSyncChange(
      "settings",
      remoteCopy({
        dashboard: { widgets: ["todos"], wallpaper: { kind: "color", value: "#fff" } },
        updatedAt: h.fake.clock + 1,
      }),
    );
    await settle();
    expect(local(h.fake).dashboard).toEqual({
      widgets: ["todos"],
      wallpaper: { kind: "image", value: "idb:x" },
    });
  });

  it("a pulled change of suspend.enabled / sessions.everyMinutes repairs alarms", async () => {
    const h = await setup();
    await h.ok("settings.update", { patch: { syncSettings: true } });
    expect(h.fake.alarms.has("suspend-scan")).toBe(false);
    h.fake.remoteSyncChange(
      "settings",
      remoteCopy({
        suspend: { enabled: true, afterMinutes: 30, whitelist: [] },
        sessions: { everyMinutes: 7, keep: 10 },
        updatedAt: h.fake.clock + 1,
      }),
    );
    await settle();
    expect(h.fake.alarms.has("suspend-scan")).toBe(true);
    expect(h.fake.alarms.get("session-gen")?.periodInMinutes).toBe(7);
    h.fake.remoteSyncChange("settings", remoteCopy({ updatedAt: h.fake.clock + 2 }));
    await settle();
    expect(h.fake.alarms.has("suspend-scan")).toBe(false);
  });

  it("init pulls a newer remote copy before alarm repair", async () => {
    const h = await setup({
      before: (f) => {
        f.local.set(Keys.settings, { ...DEFAULT_SETTINGS, syncSettings: true, updatedAt: 100 });
        f.sync.set(
          "settings",
          remoteCopy({
            theme: "dark",
            suspend: { enabled: true, afterMinutes: 30, whitelist: [] },
            updatedAt: 200,
          }),
        );
      },
    });
    expect(local(h.fake)).toMatchObject({ theme: "dark", updatedAt: 200, rev: 1 });
    expect(h.fake.alarms.has("suspend-scan")).toBe(true);
    expect(h.fake.calls).not.toContain("sync.set");
  });

  it("init survives an unreadable sync area", async () => {
    const h = await setup({
      before: (f) => {
        f.local.set(Keys.settings, { ...DEFAULT_SETTINGS, syncSettings: true });
        f.failNext("sync.get");
      },
    });
    expect(h.svc.barrier.isDegraded).toBe(false);
    expect(status(h.fake)).toMatchObject({ enabled: true, error: "unavailable" });
  });
});

describe("settings sync: turning on and syncNow", () => {
  it("turning sync on pulls a newer remote first, then pushes", async () => {
    const h = await setup({
      before: (f) => f.sync.set("settings", remoteCopy({ theme: "dark", updatedAt: 50 })),
    });
    const s = await h.ok("settings.update", { patch: { syncSettings: true } });
    expect(s).toMatchObject({ theme: "dark", syncSettings: true, updatedAt: 50, rev: 2 });
    expect(local(h.fake)).toEqual(s);
    const get = h.fake.calls.indexOf("sync.get");
    expect(get).toBeGreaterThan(-1);
    expect(h.fake.calls.indexOf("sync.set")).toBeGreaterThan(get);
    expect(status(h.fake)).toMatchObject({
      enabled: true,
      lastPullAt: h.fake.clock,
      lastPushAt: h.fake.clock,
    });
  });

  it("turning sync on keeps local settings edited after the remote copy", async () => {
    const h = await setup({
      before: (f) => f.sync.set("settings", remoteCopy({ theme: "dark", updatedAt: 50 })),
    });
    await h.ok("settings.update", { patch: { theme: "light" } }); // updatedAt = clock > 50
    const s = await h.ok("settings.update", { patch: { syncSettings: true } });
    expect(s).toMatchObject({ theme: "light", rev: 2 });
    expect(remote(h.fake)).toMatchObject({ theme: "light", updatedAt: s.updatedAt });
  });

  it("settings.syncNow: invalid while off; pull-then-push while on", async () => {
    const h = await setup();
    expect(await h.rpc("settings.syncNow", {})).toMatchObject({ ok: false, code: "invalid" });
    await h.ok("settings.update", { patch: { syncSettings: true } });
    // another device wrote while our listener was not running
    h.fake.sync.set("settings", remoteCopy({ theme: "dark", updatedAt: h.fake.clock + 5 }));
    h.fake.advance(1000);
    const st = await h.ok("settings.syncNow", {});
    expect(local(h.fake)).toMatchObject({ theme: "dark", updatedAt: h.fake.clock - 1000 + 5 });
    expect(st).toEqual({ enabled: true, lastPullAt: h.fake.clock, lastPushAt: h.fake.clock });
    expect(status(h.fake)).toEqual(st);
    expect(await h.rpc("settings.syncNow", {})).toMatchObject({ ok: true });
  });
});
