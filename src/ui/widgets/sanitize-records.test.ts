/** The Phase 4 record sanitizers in records.ts / src/ui/sanitize.ts (todos, notes, pomodoro, rev). */
import { describe, expect, it } from "vitest";
import { sanitizeRev } from "../sanitize";
import { sanitizeNote, sanitizePomodoro, sanitizeTodoList } from "./records";

describe("Phase 4 record sanitizers", () => {
  it("sanitizeTodoList keeps valid items, defaults fields, missing = empty at rev 0", () => {
    expect(sanitizeTodoList(undefined)).toEqual({ items: [], rev: 0 });
    const out = sanitizeTodoList({
      rev: 7,
      items: [
        { id: "a", text: "ok", done: true, order: 2, createdAt: 1, doneAt: 3 },
        { id: "b", text: "loose", done: "yes", order: "x" },
        { id: 5, text: "dropped" },
        { id: "c" },
        "junk",
        null,
      ],
    });
    expect(out).toEqual({
      rev: 7,
      items: [
        { id: "a", text: "ok", done: true, order: 2, createdAt: 1, doneAt: 3 },
        { id: "b", text: "loose", done: false, order: 0, createdAt: 0 },
      ],
    });
  });

  it("sanitizeNote defaults content and rev", () => {
    expect(sanitizeNote(null)).toEqual({ content: "", updatedAt: 0, rev: 0 });
    expect(sanitizeNote({ content: 5, rev: -1 })).toEqual({ content: "", updatedAt: 0, rev: 0 });
    expect(sanitizeNote({ content: "x", updatedAt: 2, rev: 3 })).toEqual({
      content: "x",
      updatedAt: 2,
      rev: 3,
    });
  });

  it("sanitizePomodoro is null unless phase / endsAt / round are valid", () => {
    expect(sanitizePomodoro({ phase: "work", endsAt: 10, round: 1 })).toEqual({
      phase: "work",
      endsAt: 10,
      round: 1,
    });
    expect(sanitizePomodoro({ phase: "nap", endsAt: 10, round: 1 })).toBeNull();
    expect(sanitizePomodoro({ phase: "break", endsAt: "10", round: 1 })).toBeNull();
    expect(sanitizePomodoro(undefined)).toBeNull();
  });

  it("sanitizeRev accepts non-negative integers only", () => {
    expect(sanitizeRev({ rev: 3 })).toBe(3);
    expect(sanitizeRev({ rev: 1.5 })).toBe(0);
    expect(sanitizeRev({ rev: -2 })).toBe(0);
    expect(sanitizeRev([])).toBe(0);
  });
});
