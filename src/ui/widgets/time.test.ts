import { describe, expect, it } from "vitest";
import { formatRemaining, greetingKey, msToNextMinute } from "./time";

describe("greetingKey", () => {
  it("maps local hours to morning / afternoon / evening / night", () => {
    const at = (h: number) => greetingKey(h);
    expect([0, 1, 4].map(at)).toEqual(Array(3).fill("dashGreetingNight"));
    expect([5, 8, 11].map(at)).toEqual(Array(3).fill("dashGreetingMorning"));
    expect([12, 14, 16].map(at)).toEqual(Array(3).fill("dashGreetingAfternoon"));
    expect([17, 19, 21].map(at)).toEqual(Array(3).fill("dashGreetingEvening"));
    expect([22, 23].map(at)).toEqual(Array(2).fill("dashGreetingNight"));
  });
});

describe("formatRemaining", () => {
  it("formats mm:ss, rounding up, never negative", () => {
    expect(formatRemaining(25 * 60_000)).toBe("25:00");
    expect(formatRemaining(24 * 60_000 + 59_001)).toBe("25:00");
    expect(formatRemaining(59_999)).toBe("01:00");
    expect(formatRemaining(1)).toBe("00:01");
    expect(formatRemaining(0)).toBe("00:00");
    expect(formatRemaining(-5000)).toBe("00:00");
    expect(formatRemaining(100 * 60_000)).toBe("100:00");
  });
});

describe("msToNextMinute", () => {
  it("waits for the next minute boundary (at least 50 ms)", () => {
    expect(msToNextMinute(60_000 * 10)).toBe(60_000);
    expect(msToNextMinute(60_000 * 10 + 59_990)).toBe(50);
    expect(msToNextMinute(60_000 * 10 + 1_000)).toBe(59_000);
  });
});
