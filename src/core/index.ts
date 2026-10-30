/** Public API of the pure domain layer. Nothing here touches browser APIs. */
export * from "./backup";
export * from "./model/id";
export * from "./model/migrations";
export * from "./model/schemas";
export * from "./model/types";
export * from "./ops/snapshot";
export * from "./ops/switch-planner";
export * from "./ops/types";
export * from "./ops/url";
export type { PomodoroSettings } from "./pomodoro/machine";
/** Pomodoro state machine: `pomodoro.start/complete/skip/remainingMs/phaseDurationMs`. */
export * as pomodoro from "./pomodoro/machine";
export * from "./reconcile/matcher";
export * from "./search";
export * from "./suspend/rules";
