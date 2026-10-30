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

/** A remote copy as another device would push it (no rev, no theme). */
function remoteCopy(over: Partial<Settings>): Record<string, unknown> {
  const {
    rev: _rev,
    theme: _theme,
    ...rest
  } = { ...structuredClone(DEFAULT_SETTINGS), syncSettings: true };
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

  it("pushes the settings without rev and theme when sync is on", async () => {
    const h = await setup();
    const on = await h.ok("settings.update", { patch: { syncSettings: true, theme: "dark" } });
    expect(remote(h.fake)).toEqual(
      (({ rev: _r, theme: _t, ...rest }) => rest)(JSON.parse(JSON.stringify(on)) as Settings),
    );
    expect(remote(h.fake)).not.toHaveProperty("rev");
    expect(remote(h.fake)).not.toHaveProperty("theme");
    expect(status(h.fake)).toEqual({ enabled: true, lastPushAt: h.fake.clock });
    h.fake.advance(1000);
    await h.ok("settings.update", { patch: { restoreLimit: 77 } });
    expect(remote(h.fake)).toMatchObject({ restoreLimit: 77, updatedAt: h.fake.clock });
  });

  it("local updatedAt is monotonic: after a pull stamped in the future, and between quick edits", async () => {
    const h = await setup();
    await h.ok("settings.update", { patch: { syncSettings: true } });
    const future = h.fake.clock + 60_000; // the other device's clock runs ahead
    h.fake.remoteSyncChange("settings", remoteCopy({ restoreLimit: 50, updatedAt: future }));
    await settle();
    expect(local(h.fake)).toMatchObject({ restoreLimit: 50, updatedAt: future });
    const a = await h.ok("settings.update", { patch: { restoreLimit: 60 } });
    expect(a.updatedAt).toBe(future + 1);
    expect(remote(h.fake)).toMatchObject({ restoreLimit: 60, updatedAt: future + 1 });
    const b = await h.ok("settings.update", { patch: { restoreLimit: 70 } }); // same clock
    expect(b.updatedAt).toBe(future + 2);
    // the other device sees our edit as newer than its own copy
    expect((remote(h.fake)?.updatedAt as number) > future).toBe(true);
  });

  it("size guard: a payload over QUOTA_BYTES_PER_ITEM is not written (too_large)", async () => {
    const h = await setup();
    await h.ok("settings.update", { patch: { syncSettings: true } });
    const before = syncSets(h.fake);
    const whitelist = Array.from(
      { length: 200 },
      (_, i) => `host-${i}-with-a-rather-long-name.example.com`,
    );
    const s = await h.ok("settings.update", {
      patch: { suspend: { whitelist } as never },
    });
    expect(s.suspend.whitelist).toHaveLength(200); // local kept
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
    h.fake.remoteSyncChange("settings", remoteCopy({ restoreLimit: 50, updatedAt: at }));
    await settle();
    const s = local(h.fake);
    expect(s).toMatchObject({
      restoreLimit: 50,
      updatedAt: at,
      rev: on.rev + 1,
      syncSettings: true,
    });
    expect(syncSets(h.fake)).toBe(pushes); // no bounce
    expect(status(h.fake)).toMatchObject({ enabled: true, lastPullAt: h.fake.clock });
    expect(remote(h.fake)).toMatchObject({ restoreLimit: 50, updatedAt: at });
  });

  it("theme is device-specific: a remote theme (older build) is ignored, the local one kept", async () => {
    const h = await setup();
    await h.ok("settings.update", { patch: { syncSettings: true, theme: "light" } });
    h.fake.remoteSyncChange("settings", {
      ...remoteCopy({ restoreLimit: 42, updatedAt: h.fake.clock + 10 }),
      theme: "dark",
    });
    await settle();
    expect(local(h.fake)).toMatchObject({ theme: "light", restoreLimit: 42 });
  });

  it("an older (or equal) remote copy is ignored; our own push echo is ignored", async () => {
    const h = await setup();
    const on = await h.ok("settings.update", { patch: { syncSettings: true, restoreLimit: 60 } });
    await settle(); // echo of our own push
    expect(local(h.fake).rev).toBe(on.rev);
    h.fake.remoteSyncChange(
      "settings",
      remoteCopy({ restoreLimit: 50, updatedAt: (on.updatedAt as number) - 1 }),
    );
    await settle();
    expect(local(h.fake)).toMatchObject({ restoreLimit: 60, rev: on.rev });
    expect(status(h.fake)?.lastPullAt).toBeUndefined();
  });

  it("an invalid remote copy keeps local and records invalid_remote", async () => {
    const h = await setup();
    const on = await h.ok("settings.update", { patch: { syncSettings: true } });
    h.fake.remoteSyncChange("settings", { restoreLimit: "x", updatedAt: h.fake.clock + 10_000 });
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
    h.fake.remoteSyncChange("settings", remoteCopy({ restoreLimit: 50, updatedAt: h.fake.clock }));
    await settle();
    expect(local(h.fake).restoreLimit).toBe(DEFAULT_SETTINGS.restoreLimit);
    expect(status(h.fake)).toBeUndefined();
  });

  it("keeps the local wallpaper when the remote has none, or when the local one is an image", async () => {
    const h = await setup();
    await h.ok("settings.update", {
      patch: { syncSettings: true, dashboard: { wallpaper: { kind: "color", value: "#123" } } },
    } as never);
    const noWall = remoteCopy({ restoreLimit: 50, updatedAt: h.fake.clock + 1 });
    delete (noWall.dashboard as Record<string, unknown>).wallpaper;
    h.fake.remoteSyncChange("settings", noWall);
    await settle();
    expect(local(h.fake).restoreLimit).toBe(50);
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
            restoreLimit: 50,
            suspend: { enabled: true, afterMinutes: 30, whitelist: [] },
            updatedAt: 200,
          }),
        );
      },
    });
    expect(local(h.fake)).toMatchObject({ restoreLimit: 50, updatedAt: 200, rev: 1 });
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
  it("turning sync on pulls a newer remote first; no push when that made us identical", async () => {
    const h = await setup({
      before: (f) => f.sync.set("settings", remoteCopy({ restoreLimit: 50, updatedAt: 50 })),
    });
    const s = await h.ok("settings.update", { patch: { syncSettings: true } });
    expect(s).toMatchObject({ restoreLimit: 50, syncSettings: true, updatedAt: 50, rev: 2 });
    expect(local(h.fake)).toEqual(s);
    expect(h.fake.calls).toContain("sync.get");
    expect(h.fake.calls).not.toContain("sync.set");
    expect(status(h.fake)).toEqual({ enabled: true, lastPullAt: h.fake.clock });
  });

  it("turning sync on pulls, then pushes when the pulled copy differs from our payload", async () => {
    const h = await setup({
      before: (f) =>
        // an older build's copy: carries a theme (and an unknown field) we never push
        f.sync.set("settings", {
          ...remoteCopy({ restoreLimit: 50, updatedAt: 50 }),
          theme: "dark",
        }),
    });
    const s = await h.ok("settings.update", { patch: { syncSettings: true } });
    expect(s).toMatchObject({ restoreLimit: 50, theme: "system", updatedAt: 50 });
    const get = h.fake.calls.indexOf("sync.get");
    expect(h.fake.calls.indexOf("sync.set")).toBeGreaterThan(get);
    expect(remote(h.fake)).not.toHaveProperty("theme");
    expect(status(h.fake)).toMatchObject({
      enabled: true,
      lastPullAt: h.fake.clock,
      lastPushAt: h.fake.clock,
    });
  });

  it("turning sync on keeps local settings edited after the remote copy", async () => {
    const h = await setup({
      before: (f) => f.sync.set("settings", remoteCopy({ restoreLimit: 50, updatedAt: 50 })),
    });
    await h.ok("settings.update", { patch: { restoreLimit: 60 } }); // updatedAt = clock > 50
    const s = await h.ok("settings.update", { patch: { syncSettings: true } });
    expect(h.fake.calls).toContain("sync.set"); // local newer: pushed
    expect(s).toMatchObject({ restoreLimit: 60, rev: 2 });
    expect(remote(h.fake)).toMatchObject({ restoreLimit: 60, updatedAt: s.updatedAt });
  });

  it("settings.syncNow: invalid while off; pull-then-push while on", async () => {
    const h = await setup();
    expect(await h.rpc("settings.syncNow", {})).toMatchObject({ ok: false, code: "invalid" });
    await h.ok("settings.update", { patch: { syncSettings: true } });
    await settle(); // the echo of our own push is handled before the remote write below
    // another device wrote while our listener was not running
    const pushedAt = h.fake.clock;
    h.fake.sync.set("settings", remoteCopy({ restoreLimit: 50, updatedAt: h.fake.clock + 5 }));
    h.fake.advance(1000);
    const sets = syncSets(h.fake);
    const st = await h.ok("settings.syncNow", {});
    expect(local(h.fake)).toMatchObject({ restoreLimit: 50, updatedAt: h.fake.clock - 1000 + 5 });
    // the pull made us identical to the remote copy: no push
    expect(syncSets(h.fake)).toBe(sets);
    expect(st).toEqual({ enabled: true, lastPullAt: h.fake.clock, lastPushAt: pushedAt });
    expect(status(h.fake)).toEqual(st);
    // nothing newer remotely: syncNow pushes
    h.fake.advance(10);
    expect(await h.ok("settings.syncNow", {})).toMatchObject({ lastPushAt: h.fake.clock });
    expect(syncSets(h.fake)).toBe(sets + 1);
  });
});
