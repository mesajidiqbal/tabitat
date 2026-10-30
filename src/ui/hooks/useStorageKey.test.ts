import { describe, expect, it } from "vitest";
import { shouldApplyInitial } from "./useStorageKey";

describe("shouldApplyInitial", () => {
  it("applies the initial read only when no change arrived first (newer wins)", () => {
    expect(shouldApplyInitial(false)).toBe(true);
    expect(shouldApplyInitial(true)).toBe(false);
  });
});
