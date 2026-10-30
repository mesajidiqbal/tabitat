import { describe, expect, it } from "vitest";
import { buildPlaceholderUrl } from "../ops/url";
import { BASE, liveTab, NOW } from "../testing/fixtures";
import {
  eligibleForDiscard,
  findDuplicates,
  isWhitelisted,
  normalizeWhitelistEntry,
} from "./rules";

const MIN = 60_000;
const cfg = { enabled: true, afterMinutes: 30, whitelist: ["keep.com", "*.wild.org"] };
const old = NOW - 31 * MIN;
const opts = { placeholderBase: BASE };

describe("eligibleForDiscard", () => {
  const base = liveTab({ url: "https://site.com/x", lastAccessed: old });

  it("accepts an old, idle, background http(s) tab", () => {
    expect(eligibleForDiscard(base, cfg, NOW, opts)).toBe(true);
    expect(eligibleForDiscard({ ...base, url: "http://site.com" }, cfg, NOW, opts)).toBe(true);
    expect(eligibleForDiscard({ ...base, lastAccessed: NOW - 30 * MIN }, cfg, NOW, opts)).toBe(
      true,
    );
  });

  it.each([
    ["active", { active: true }],
    ["pinned", { pinned: true }],
    ["audible", { audible: true }],
    ["discarded", { discarded: true }],
    ["recent", { lastAccessed: NOW - 29 * MIN }],
    ["no lastAccessed", { lastAccessed: undefined }],
    ["file scheme", { url: "file:///a" }],
    ["chrome scheme", { url: "chrome://settings" }],
    ["invalid url", { url: "nope" }],
    ["whitelisted host", { url: "https://keep.com/a" }],
    ["whitelisted subdomain", { url: "https://www.keep.com/a" }],
    ["wildcard entry", { url: "https://a.wild.org" }],
    ["wildcard apex", { url: "https://wild.org" }],
  ])("rejects %s", (_name, over) => {
    expect(eligibleForDiscard({ ...base, ...over }, cfg, NOW, opts)).toBe(false);
  });

  it("rejects our placeholders even if the base were http(s)", () => {
    const httpBase = "https://ext.test/suspended.html";
    const url = buildPlaceholderUrl(httpBase, { u: "https://a.com", t: "", w: "", s: "" });
    expect(eligibleForDiscard({ ...base, url }, cfg, NOW, { placeholderBase: httpBase })).toBe(
      false,
    );
  });

  it("does not match lookalike hosts", () => {
    expect(eligibleForDiscard({ ...base, url: "https://notkeep.com" }, cfg, NOW, opts)).toBe(true);
  });
});

describe("whitelist", () => {
  it.each([
    ["Example.COM", "example.com"],
    ["*.example.com", "example.com"],
    [".example.com", "example.com"],
    ["https://example.com/path", "example.com"],
    ["example.com:8080", "example.com"],
    ["example.com/path", "example.com"],
    ["   ", null],
    ["https://", null],
  ])("normalizes %s -> %s", (input, out) => {
    expect(normalizeWhitelistEntry(input)).toBe(out);
  });
  it("matches host or subdomain", () => {
    expect(isWhitelisted("A.Example.com", ["example.com"])).toBe(true);
    expect(isWhitelisted("example.com.evil.net", ["example.com"])).toBe(false);
    expect(isWhitelisted("example.com", ["", " "])).toBe(false);
  });
});

describe("findDuplicates", () => {
  it("groups by normalized, unwrapped URL with the keeper first", () => {
    const ph = buildPlaceholderUrl(BASE, { u: "https://a.com/", t: "", w: "", s: "" });
    const tabs = [
      liveTab({ id: 1, index: 0, url: "https://a.com", lastAccessed: 100 }),
      liveTab({ id: 2, index: 1, url: "https://b.com/x#1", lastAccessed: 100 }),
      liveTab({ id: 3, index: 2, url: ph }),
      liveTab({ id: 4, index: 3, url: "https://a.com/#top", lastAccessed: 500 }),
      liveTab({ id: 5, index: 4, url: "https://b.com/x/", lastAccessed: 100 }),
      liveTab({ id: 6, index: 5, url: "https://a.com", active: true, lastAccessed: 1 }),
      liveTab({ id: 7, index: 6, url: "https://c.com" }),
      liveTab({ id: 8, index: 7, url: "https://a.com", pinned: true }),
      liveTab({ id: 9, index: 8, url: "" }),
      liveTab({ id: 10, index: 9, url: "" }),
    ];
    expect(findDuplicates(tabs, opts)).toEqual([
      [6, 4, 1, 3],
      [2, 5],
    ]);
  });

  it("without a base, placeholders are compared as-is", () => {
    const ph = buildPlaceholderUrl(BASE, { u: "https://a.com/", t: "", w: "", s: "" });
    const tabs = [liveTab({ id: 1, url: "https://a.com" }), liveTab({ id: 2, url: ph })];
    expect(findDuplicates(tabs)).toEqual([]);
  });
});
