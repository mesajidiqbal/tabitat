/** Clock / pomodoro display helpers (pure). */
import type { MsgKey } from "@/i18n";

/** Greeting by local hour: 5–11 morning, 12–16 afternoon, 17–21 evening, otherwise night. */
export function greetingKey(hour: number): MsgKey {
  if (hour >= 5 && hour < 12) return "dashGreetingMorning";
  if (hour >= 12 && hour < 17) return "dashGreetingAfternoon";
  if (hour >= 17 && hour < 22) return "dashGreetingEvening";
  return "dashGreetingNight";
}

/** "mm:ss" for a remaining duration (rounded up to the second; never negative). */
export function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** ms until the next minute boundary (at least 50 ms). */
export const msToNextMinute = (now: number): number => Math.max(50, 60_000 - (now % 60_000));
