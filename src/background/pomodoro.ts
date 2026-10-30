/** Pomodoro timer in the worker: state under `pomodoro`, alarm at `endsAt`, notification on phase change. */

import type { PomodoroState } from "../core/model/types";
import { Keys } from "../core/model/types";
import * as pomodoro from "../core/pomodoro/machine";
import type { BgContext } from "./context";

export const POMODORO_ALARM = "pomodoro";

const LABEL: Record<PomodoroState["phase"], string> = {
  work: "Focus",
  break: "Short break",
  longBreak: "Long break",
};

export class PomodoroService {
  constructor(private readonly ctx: BgContext) {}

  private async arm(state: PomodoroState): Promise<void> {
    await this.ctx.ports.alarms.create(POMODORO_ALARM, { when: state.endsAt });
  }

  async start(): Promise<PomodoroState> {
    const settings = await this.ctx.repo.getSettings();
    const state = pomodoro.start(settings.pomodoro, this.ctx.ports.now());
    await this.ctx.repo.setMany({ [Keys.pomodoro]: state });
    await this.arm(state);
    return state;
  }

  async stop(): Promise<null> {
    await this.ctx.repo.setMany({ [Keys.pomodoro]: null });
    await this.ctx.ports.alarms.clear(POMODORO_ALARM);
    return null;
  }

  async skip(): Promise<PomodoroState | null> {
    const cur = await this.ctx.repo.getPomodoro();
    if (!cur) return null;
    const settings = await this.ctx.repo.getSettings();
    const next = pomodoro.skip(cur, settings.pomodoro, this.ctx.ports.now());
    await this.ctx.repo.setMany({ [Keys.pomodoro]: next });
    await this.arm(next);
    return next;
  }

  /** Alarm handler: advances the phase when it is due (re-arms if the alarm fired early). */
  async onAlarm(): Promise<PomodoroState | null> {
    const cur = await this.ctx.repo.getPomodoro();
    if (!cur) return null;
    const now = this.ctx.ports.now();
    if (now < cur.endsAt - 1_000) {
      await this.arm(cur);
      return cur;
    }
    const settings = await this.ctx.repo.getSettings();
    const next = pomodoro.complete(cur, settings.pomodoro, now);
    await this.ctx.repo.setMany({ [Keys.pomodoro]: next });
    await this.arm(next);
    await this.ctx.ports.shell
      .notify(`pomodoro-${now}`, `${LABEL[cur.phase]} finished`, `${LABEL[next.phase]} started`)
      .catch((e) => this.ctx.log.warn("[tabitat] notification failed", e));
    return next;
  }
}
