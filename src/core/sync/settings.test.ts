import { describe, expect, it } from "vitest";
import { parseSettings } from "../model/schemas";
import { DEFAULT_SETTINGS, type Settings } from "../model/types";
import {
  applyRemoteSettings,
  classifySyncError,
  isRemoteNewer,
  nextLocalUpdatedAt,
  syncItemBytes,
  toSyncPayload,
} from "./settings";

const settings = (over: Partial<Settings> = {}): Settings => ({
  ...structuredClone(DEFAULT_SETTINGS),
  ...over,
});

describe("settings sync rules", () => {
  it("toSyncPayload drops rev, theme and an image wallpaper only", () => {
    const s = settings({ rev: 7, updatedAt: 5, theme: "dark" });
    expect(toSyncPayload(s)).not.toHaveProperty("rev");
    expect(toSyncPayload(s)).not.toHaveProperty("theme");
    expect(toSyncPayload(s)).toMatchObject({ updatedAt: 5, restoreLimit: s.restoreLimit });
    expect(toSyncPayload(s).dashboard.wallpaper).toEqual(s.dashboard.wallpaper);
    const img = settings({
      dashboard: { widgets: ["clock"], wallpaper: { kind: "image", value: "idb:1" } },
    });
    expect(toSyncPayload(img).dashboard).toEqual({ widgets: ["clock"] });
    expect(img.dashboard.wallpaper.kind).toBe("image"); // input untouched
  });

  it("isRemoteNewer: strict, missing counts as 0", () => {
    expect(isRemoteNewer(2, 1)).toBe(true);
    expect(isRemoteNewer(1, 1)).toBe(false);
    expect(isRemoteNewer(undefined, undefined)).toBe(false);
    expect(isRemoteNewer(1, undefined)).toBe(true);
    expect(isRemoteNewer(undefined, 1)).toBe(false);
  });

  it("nextLocalUpdatedAt: now, or one past the stored stamp when that is not older", () => {
    expect(nextLocalUpdatedAt(100, undefined)).toBe(100);
    expect(nextLocalUpdatedAt(100, 50)).toBe(100);
    expect(nextLocalUpdatedAt(100, 100)).toBe(101);
    expect(nextLocalUpdatedAt(100, 5000)).toBe(5001);
  });

  it("applyRemoteSettings: remote values, local syncSettings and theme, rev + 1, remote updatedAt", () => {
    const local = settings({ rev: 4, updatedAt: 10, syncSettings: true, theme: "light" });
    // an older build may still push a theme: it is ignored
    const raw = {
      ...toSyncPayload(settings({ restoreLimit: 50 })),
      theme: "dark",
      updatedAt: 20,
    };
    const next = applyRemoteSettings(local, parseSettings(raw), raw);
    expect(next).toMatchObject({
      theme: "light",
      restoreLimit: 50,
      rev: 5,
      updatedAt: 20,
      syncSettings: true,
    });
  });

  it("applyRemoteSettings keeps the local wallpaper when the remote has none or either is an image", () => {
    const local = settings({
      dashboard: { widgets: [], wallpaper: { kind: "color", value: "#000" } },
    });
    const missing = { dashboard: { widgets: ["clock"] }, updatedAt: 3 };
    expect(applyRemoteSettings(local, parseSettings(missing), missing).dashboard).toEqual({
      widgets: ["clock"],
      wallpaper: { kind: "color", value: "#000" },
    });
    const remoteImage = { dashboard: { wallpaper: { kind: "image", value: "x" } } };
    expect(
      applyRemoteSettings(local, parseSettings(remoteImage), remoteImage).dashboard.wallpaper,
    ).toEqual({ kind: "color", value: "#000" });
    const imgLocal = settings({
      dashboard: { widgets: [], wallpaper: { kind: "image", value: "idb" } },
    });
    const grad = { dashboard: { wallpaper: { kind: "gradient", value: "dusk" } } };
    expect(applyRemoteSettings(imgLocal, parseSettings(grad), grad).dashboard.wallpaper).toEqual({
      kind: "image",
      value: "idb",
    });
  });

  it("syncItemBytes counts key + JSON in UTF-8; errors are classified", () => {
    expect(syncItemBytes("k", "é")).toBe(1 + 4);
    expect(classifySyncError(new Error("QUOTA_BYTES quota exceeded"))).toBe("quota");
    expect(classifySyncError(new Error("MAX_WRITE_OPERATIONS_PER_MINUTE quota exceeded"))).toBe(
      "quota",
    );
    expect(classifySyncError(new Error("QUOTA_BYTES_PER_ITEM quota exceeded"))).toBe("too_large");
    expect(classifySyncError("offline")).toBe("unavailable");
  });
});
