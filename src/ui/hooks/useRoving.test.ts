import { describe, expect, it } from "vitest";
import { rovingAction } from "./useRoving";

describe("rovingAction", () => {
  it("ArrowDown / ArrowUp move one node, clamped to the list", () => {
    expect(rovingAction("ArrowDown", 0, 3, false)).toEqual({ kind: "focus", index: 1 });
    expect(rovingAction("ArrowDown", 2, 3, false)).toEqual({ kind: "focus", index: 2 });
    expect(rovingAction("ArrowUp", 2, 3, false)).toEqual({ kind: "focus", index: 1 });
    expect(rovingAction("ArrowUp", 0, 3, false)).toEqual({ kind: "focus", index: 0 });
  });

  it("Home / End jump to the first / last node", () => {
    expect(rovingAction("Home", 2, 5, true)).toEqual({ kind: "focus", index: 0 });
    expect(rovingAction("End", 0, 5, true)).toEqual({ kind: "focus", index: 4 });
  });

  it("ArrowUp on the first node exits the top when the list has an exit", () => {
    expect(rovingAction("ArrowUp", 0, 3, true)).toEqual({ kind: "exitTop" });
    expect(rovingAction("ArrowUp", 1, 3, true)).toEqual({ kind: "focus", index: 0 });
  });

  it("ignores other keys", () => {
    for (const k of ["Enter", " ", "a", "Tab", "ArrowLeft", "Escape"])
      expect(rovingAction(k, 1, 3, true)).toBeNull();
  });

  it("does nothing on an empty list", () => {
    for (const k of ["ArrowDown", "ArrowUp", "Home", "End"])
      expect(rovingAction(k, 0, 0, true)).toBeNull();
  });

  it("an out-of-range index is clamped", () => {
    expect(rovingAction("ArrowDown", 7, 3, false)).toEqual({ kind: "focus", index: 2 });
    expect(rovingAction("ArrowUp", -1, 3, false)).toEqual({ kind: "focus", index: 0 });
  });
});
