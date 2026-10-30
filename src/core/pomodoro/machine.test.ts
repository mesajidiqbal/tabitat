import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../model/types";
import { NOW } from "../testing/fixtures";
import { complete, phaseDurationMs, remainingMs, skip, start } from "./machine";

const p = DEFAULT_SETTINGS.pomodoro; // 25 / 5 / 15, long every 4
const MIN = 60_000;

describe("pomodoro machine", () => {
  it("starts with round 1 work", () => {
    expect(start(p, NOW)).toEqual({ phase: "work", endsAt: NOW + 25 * MIN, round: 1 });
  });

  it("cycles work -> break -> work … -> longBreak after roundsBeforeLong", () => {
    let s = start(p, NOW);
    const seen: string[] = [];
    for (let i = 0; i < 16; i++) {
      s = complete(s, p, NOW);
      seen.push(`${s.phase}:${s.round}`);
    }
    expect(seen).toEqual([
      "break:1",
      "work:2",
      "break:2",
      "work:3",
      "break:3",
      "work:4",
      "longBreak:4",
      "work:5",
      "break:5",
      "work:6",
      "break:6",
      "work:7",
      "break:7",
      "work:8",
      "longBreak:8",
      "work:9",
    ]);
  });

  it("schedules each phase from now", () => {
    const later = NOW + 123;
    expect(complete(start(p, NOW), p, later).endsAt).toBe(later + 5 * MIN);
    expect(complete({ phase: "work", endsAt: 0, round: 4 }, p, later).endsAt).toBe(
      later + 15 * MIN,
    );
    expect(complete({ phase: "longBreak", endsAt: 0, round: 4 }, p, later)).toEqual({
      phase: "work",
      endsAt: later + 25 * MIN,
      round: 5,
    });
  });

  it("treats roundsBeforeLong < 1 as every round", () => {
    const s = complete({ phase: "work", endsAt: 0, round: 3 }, { ...p, roundsBeforeLong: 0 }, NOW);
    expect(s.phase).toBe("longBreak");
  });

  it("skip is complete", () => {
    expect(skip).toBe(complete);
  });

  it("remainingMs clamps at zero", () => {
    const s = start(p, NOW);
    expect(remainingMs(s, NOW)).toBe(25 * MIN);
    expect(remainingMs(s, NOW + 30 * MIN)).toBe(0);
  });

  it("phaseDurationMs", () => {
    expect(phaseDurationMs("break", p)).toBe(5 * MIN);
  });
});
