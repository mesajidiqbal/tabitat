import { describe, expect, it } from "vitest";
import { isPlainObject, sanitizeClosed, sanitizeRecovery, sanitizeTrash } from "./sanitize";

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

describe("isPlainObject", () => {
  it("accepts objects only (not null or arrays)", () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject(null)).toBe(false);
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject("a")).toBe(false);
  });
});
