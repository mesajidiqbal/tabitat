import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, LIMITS } from "@/core/model/types";
import { clamp, formatBytes, parseSettingsLoose, parseWhole, RANGES, resetPatch } from "./settings";
import { parseSyncStatus, syncErrorKey } from "./sync-status";
import { parseWhitelist, validHost } from "./whitelist";

describe("parseSettingsLoose", () => {
  it("falls back to the defaults for non-objects", () => {
    expect(parseSettingsLoose(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettingsLoose("x")).toEqual(DEFAULT_SETTINGS);
    expect(parseSettingsLoose([])).toEqual(DEFAULT_SETTINGS);
  });

  it("keeps valid fields and repairs invalid ones", () => {
    const s = parseSettingsLoose({
      theme: "dark",
      suspend: { enabled: true, afterMinutes: -3, whitelist: ["a.com", 7, null] },
      sessions: { everyMinutes: 2.5, keep: 12 },
      restoreLimit: "lots",
      rev: 7,
      updatedAt: 123,
    });
    expect(s.theme).toBe("dark");
    expect(s.suspend).toEqual({ enabled: true, afterMinutes: 30, whitelist: ["a.com"] });
    expect(s.sessions).toEqual({ everyMinutes: 5, keep: 12 });
    expect(s.restoreLimit).toBe(100);
    expect(s.rev).toBe(7);
    expect(s.updatedAt).toBe(123);
  });
});

describe("numbers", () => {
  it("parses whole numbers only", () => {
    expect(parseWhole(" 15 ")).toBe(15);
    expect(parseWhole("")).toBeNull();
    expect(parseWhole("1.5")).toBeNull();
    expect(parseWhole("-4")).toBeNull();
    expect(parseWhole("1e3")).toBeNull();
  });

  it("clamps into a range", () => {
    expect(clamp(1, RANGES.suspendMinutes.min, RANGES.suspendMinutes.max)).toBe(5);
    expect(clamp(9999, RANGES.suspendMinutes.min, RANGES.suspendMinutes.max)).toBe(720);
  });

  it("formats bytes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});

describe("resetPatch", () => {
  it("is DEFAULT_SETTINGS without rev and updatedAt, as an independent copy", () => {
    const p = resetPatch();
    expect("rev" in p).toBe(false);
    expect("updatedAt" in p).toBe(false);
    expect(p.suspend).toEqual(DEFAULT_SETTINGS.suspend);
    p.suspend.whitelist.push("x.com");
    expect(DEFAULT_SETTINGS.suspend.whitelist).toEqual([]);
  });
});

describe("parseWhitelist", () => {
  it("normalizes, de-duplicates and keeps first-seen order", () => {
    const p = parseWhitelist(
      "Example.com\n*.docs.example.com\nhttps://mail.example.com/inbox\nexample.com\n\n  \n",
    );
    expect(p.hosts).toEqual(["example.com", "docs.example.com", "mail.example.com"]);
    expect(p.invalid).toEqual([]);
    expect(p.overLimit).toBe(false);
  });

  it("flags invalid lines with their line numbers", () => {
    const p = parseWhitelist("ok.com\nnot a host\n-bad-.com\nfine.org");
    expect(p.hosts).toEqual(["ok.com", "fine.org"]);
    expect(p.invalid).toEqual([
      { line: 2, text: "not a host" },
      { line: 3, text: "-bad-.com" },
    ]);
  });

  it("accepts localhost, IPv4 and IDN (as punycode)", () => {
    expect(validHost("localhost")).toBe("localhost");
    expect(validHost("192.168.1.10")).toBe("192.168.1.10");
    expect(validHost("bücher.de")).toBe("xn--bcher-kva.de");
  });

  it("reports more than the host limit", () => {
    const lines = Array.from({ length: LIMITS.whitelistHosts + 1 }, (_, i) => `h${i}.example.com`);
    expect(parseWhitelist(lines.join("\n")).overLimit).toBe(true);
    expect(parseWhitelist(lines.slice(0, LIMITS.whitelistHosts).join("\n")).overLimit).toBe(false);
  });
});

describe("sync status", () => {
  it("parses defensively", () => {
    expect(parseSyncStatus(null)).toEqual({ enabled: false });
    expect(parseSyncStatus({ enabled: true, lastPushAt: 5, lastPullAt: "x", error: "" })).toEqual({
      enabled: true,
      lastPushAt: 5,
    });
    expect(parseSyncStatus({ enabled: true, error: "quota" }).error).toBe("quota");
  });

  it("maps every known error code to its own sentence", () => {
    expect(syncErrorKey("too_large")).toBe("optSyncErrTooLarge");
    expect(syncErrorKey("quota")).toBe("optSyncErrQuota");
    expect(syncErrorKey("unavailable")).toBe("optSyncErrUnavailable");
    expect(syncErrorKey("invalid_remote")).toBe("optSyncErrInvalidRemote");
    expect(syncErrorKey("toString")).toBe("optSyncErrUnknown");
  });
});
