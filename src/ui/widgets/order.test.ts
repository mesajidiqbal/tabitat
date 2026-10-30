import { describe, expect, it } from "vitest";
import {
  ALL_WIDGETS,
  customizeList,
  enabledWidgets,
  gridWidgets,
  moveWidget,
  toggleWidget,
} from "./order";

describe("widget order helpers", () => {
  it("enabledWidgets keeps valid ids once, in stored order", () => {
    expect(enabledWidgets(["todos", "bogus", "clock", "todos", 3, null])).toEqual([
      "todos",
      "clock",
    ]);
    expect(enabledWidgets("nope")).toEqual([]);
    expect(enabledWidgets(undefined)).toEqual([]);
  });

  it("gridWidgets leaves out the top row (clock, search)", () => {
    expect(gridWidgets(["clock", "notes", "search", "quicklinks"])).toEqual([
      "notes",
      "quicklinks",
    ]);
  });

  it("customizeList lists enabled widgets first, then the rest in default order", () => {
    const list = customizeList(["notes", "clock"]);
    expect(list.slice(0, 2)).toEqual([
      { id: "notes", on: true },
      { id: "clock", on: true },
    ]);
    expect(list.map((x) => x.id).sort()).toEqual([...ALL_WIDGETS].sort());
    expect(list.slice(2).every((x) => !x.on)).toBe(true);
    expect(list[2]?.id).toBe("search");
  });

  it("toggleWidget appends on enable and removes on disable", () => {
    expect(toggleWidget(["clock"], "pomodoro", true)).toEqual(["clock", "pomodoro"]);
    expect(toggleWidget(["clock", "pomodoro"], "clock", false)).toEqual(["pomodoro"]);
    expect(toggleWidget(["clock"], "clock", true)).toEqual(["clock"]);
  });

  it("moveWidget swaps with a neighbour; no-op at the ends or when disabled", () => {
    expect(moveWidget(["a", "b", "c"] as never, "b" as never, -1)).toEqual(["b", "a", "c"]);
    expect(moveWidget(["clock", "todos"], "clock", 1)).toEqual(["todos", "clock"]);
    expect(moveWidget(["clock", "todos"], "clock", -1)).toEqual(["clock", "todos"]);
    expect(moveWidget(["clock", "todos"], "todos", 1)).toEqual(["clock", "todos"]);
    expect(moveWidget(["clock"], "notes", 1)).toEqual(["clock"]);
  });
});
