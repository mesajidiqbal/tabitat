/**
 * Pure pomodoro state machine. The worker persists the state under `pomodoro` and schedules an
 * alarm at `endsAt`; when it fires it calls `complete`.
 */
import type { PomodoroPhase, PomodoroState, Settings } from "../model/types";

export type PomodoroSettings = Settings["pomodoro"];

const MINUTE = 60_000;

export function phaseDurationMs(phase: PomodoroPhase, settings: PomodoroSettings): number {
  switch (phase) {
    case "work":
      return settings.workMin * MINUTE;
    case "break":
      return settings.breakMin * MINUTE;
    case "longBreak":
      return settings.longBreakMin * MINUTE;
  }
}

/** A fresh session: round 1, work phase. */
export function start(settings: PomodoroSettings, now: number): PomodoroState {
  return { phase: "work", endsAt: now + phaseDurationMs("work", settings), round: 1 };
}

/**
 * Advances to the next phase starting at `now`: work -> break (or longBreak every
 * `roundsBeforeLong` rounds); break/longBreak -> work with round + 1.
 */
export function complete(
  state: PomodoroState,
  settings: PomodoroSettings,
  now: number,
): PomodoroState {
  if (state.phase === "work") {
    const every = Math.max(1, settings.roundsBeforeLong);
    const phase: PomodoroPhase = state.round % every === 0 ? "longBreak" : "break";
    return { phase, endsAt: now + phaseDurationMs(phase, settings), round: state.round };
  }
  return { phase: "work", endsAt: now + phaseDurationMs("work", settings), round: state.round + 1 };
}

/** Skipping a phase is the same transition as completing it. */
export const skip = complete;

export function remainingMs(state: PomodoroState, now: number): number {
  return Math.max(0, state.endsAt - now);
}
