import { describe, expect, it } from "vitest";
import {
  isPlainObject,
  sanitizeClosed,
  sanitizeHint,
  sanitizeQuickLinks,
  sanitizeRecovery,
  sanitizeTrash,
} from "./sanitize";

describe("sanitizeTrash", () => {
  it("keeps plain objects with a string id", () => {
    const ok = { id: "t1", kind: "link", deletedAt: 1 };
    expect(sanitizeTrash({ items: [null, ok, 3, "x", [], { id: 7 }, { kind: "link" }] })).toEqual({
      items: [ok],
    });
  });
  it("non-object records or a missing items array read as an empty trash", () => {
    for (const raw of [undefined, null, 1, "trash", [], { items: null }, { items: {} }])
      expect(sanitizeTrash(raw)).toEqual({ items: [] });
  });
});

describe("sanitizeRecovery", () => {
  it("keeps entries with a string opId", () => {
    const e = { opId: "op1", stage: "opening" };
    expect(sanitizeRecovery({ entries: [null, e, { opId: 1 }, "op"] })).toEqual({ entries: [e] });
    expect(sanitizeRecovery({ entries: [null] })).toEqual({ entries: [] });
  });
  it("is null without an entries array", () => {
    for (const raw of [undefined, null, 0, [], { entries: "x" }, {}])
      expect(sanitizeRecovery(raw)).toBeNull();
  });
});

describe("sanitizeClosed", () => {
  it("keeps entries with a string url", () => {
    const c = { id: "c", url: "https://a.example/", title: "A", closedAt: 1 };
    expect(sanitizeClosed([c, null, { url: 5 }, { title: "no url" }, "https://b/"])).toEqual([c]);
  });
  it("non-arrays read as empty", () => {
    for (const raw of [undefined, null, {}, "x"]) expect(sanitizeClosed(raw)).toEqual([]);
  });
});

describe("sanitizeHint", () => {
  it("keeps a well-formed recovery:hint", () => {
    expect(sanitizeHint({ generation: 3, unmatchedWindows: 1, at: 5, extra: true })).toEqual({
      generation: 3,
      unmatchedWindows: 1,
      at: 5,
    });
  });
  it("is null for anything else", () => {
    for (const raw of [undefined, null, [], "x", { generation: "3", unmatchedWindows: 1, at: 5 }])
      expect(sanitizeHint(raw)).toBeNull();
    expect(sanitizeHint({ generation: 1, unmatchedWindows: Number.NaN, at: 1 })).toBeNull();
  });
});

describe("sanitizeQuickLinks", () => {
  it("keeps items with string id and url; title / order default", () => {
    const raw = {
      items: [
        { id: "a", url: "https://a.example/", title: "A", order: 2 },
        { id: "b", url: "https://b.example/", title: 7 },
        { id: 3, url: "https://c.example/" },
        { id: "d" },
        null,
      ],
      rev: 1,
    };
    expect(sanitizeQuickLinks(raw)).toEqual([
      { id: "a", url: "https://a.example/", title: "A", order: 2 },
      { id: "b", url: "https://b.example/", title: "", order: 0 },
    ]);
  });
  it("non-objects read as empty", () => {
    for (const raw of [undefined, null, [], { items: "x" }])
      expect(sanitizeQuickLinks(raw)).toEqual([]);
  });
});

describe("isPlainObject", () => {
  it("accepts objects only (not null or arrays)", () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject(null)).toBe(false);
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject("a")).toBe(false);
  });
});
