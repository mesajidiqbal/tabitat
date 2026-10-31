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

  it("without columns Left / Right are not navigation keys", () => {
    expect(rovingAction("ArrowRight", 1, 3, false)).toBeNull();
    expect(rovingAction("ArrowLeft", 1, 3, false, undefined)).toBeNull();
  });

  it("an out-of-range index is clamped", () => {
    expect(rovingAction("ArrowDown", 7, 3, false)).toEqual({ kind: "focus", index: 2 });
    expect(rovingAction("ArrowUp", -1, 3, false)).toEqual({ kind: "focus", index: 0 });
  });
});

describe("rovingAction with columns (cards, C3.3)", () => {
  // 7 cards in 3 columns:  0 1 2 / 3 4 5 / 6
  const f = (index: number) => ({ kind: "focus", index });

  it("Left / Right move one card, clamped, without wrapping", () => {
    expect(rovingAction("ArrowRight", 0, 7, false, 3)).toEqual(f(1));
    expect(rovingAction("ArrowRight", 2, 7, false, 3)).toEqual(f(3));
    expect(rovingAction("ArrowRight", 6, 7, false, 3)).toEqual(f(6));
    expect(rovingAction("ArrowLeft", 4, 7, false, 3)).toEqual(f(3));
    expect(rovingAction("ArrowLeft", 0, 7, true, 3)).toEqual(f(0));
  });

  it("Down moves one visual row, to the last card under a shorter last row, else stays", () => {
    expect(rovingAction("ArrowDown", 1, 7, false, 3)).toEqual(f(4));
    expect(rovingAction("ArrowDown", 3, 7, false, 3)).toEqual(f(6));
    expect(rovingAction("ArrowDown", 5, 7, false, 3)).toEqual(f(6));
    expect(rovingAction("ArrowDown", 6, 7, false, 3)).toEqual(f(6));
    // A full last row: Down there stays put.
    expect(rovingAction("ArrowDown", 4, 6, false, 3)).toEqual(f(4));
  });

  it("Up moves one visual row; on the first row it exits the top, or stays", () => {
    expect(rovingAction("ArrowUp", 6, 7, false, 3)).toEqual(f(3));
    expect(rovingAction("ArrowUp", 4, 7, true, 3)).toEqual(f(1));
    expect(rovingAction("ArrowUp", 2, 7, true, 3)).toEqual({ kind: "exitTop" });
    expect(rovingAction("ArrowUp", 2, 7, false, 3)).toEqual(f(2));
  });

  it("Home / End still jump; one column behaves like a list for Up / Down", () => {
    expect(rovingAction("Home", 5, 7, false, 3)).toEqual(f(0));
    expect(rovingAction("End", 0, 7, false, 3)).toEqual(f(6));
    expect(rovingAction("ArrowDown", 0, 3, false, 1)).toEqual(f(1));
    expect(rovingAction("ArrowUp", 0, 3, true, 1)).toEqual({ kind: "exitTop" });
    // A bogus column count is treated as one column.
    expect(rovingAction("ArrowDown", 0, 3, false, 0)).toEqual(f(1));
  });

  it("other keys and an empty list are still not navigation", () => {
    expect(rovingAction("Enter", 1, 7, false, 3)).toBeNull();
    expect(rovingAction("ArrowRight", 0, 0, false, 3)).toBeNull();
  });
});
