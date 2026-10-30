/**
 * Pomodoro widget (docs/PHASE4.md §4): reads the `pomodoro` key, ticks every second from `endsAt`
 * (no worker calls), Start / Stop / Skip -> pomodoro.start|stop|skip. With `docTitle` (the
 * dashboard) the page title shows "mm:ss · Tabitat" while running and is restored after.
 */
import { useEffect, useState } from "preact/hooks";
import { DEFAULT_SETTINGS, type PomodoroPhase } from "@/core/model/types";
import { type MsgKey, t } from "@/i18n";
import { send } from "@/messaging/client";
import { attempt } from "../actions";
import c from "../components/controls.module.css";
import { store } from "../store";
import { Card, type WidgetProps } from "./Card";
import { formatRemaining } from "./time";
import s from "./widgets.module.css";

const PHASE: Record<PomodoroPhase, MsgKey> = {
  work: "dashPomodoroWork",
  break: "dashPomodoroBreak",
  longBreak: "dashPomodoroLongBreak",
};

export function Pomodoro({ compact, docTitle }: WidgetProps & { docTitle?: boolean }) {
  const state = store.pomodoro.value;
  const settings = store.settings.value.pomodoro ?? DEFAULT_SETTINGS.pomodoro;
  // Re-render every second while running; the remaining time is always computed from now.
  const [, setTick] = useState(0);
  const running = state !== null;

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [running]);

  const remaining = state
    ? formatRemaining(state.endsAt - Date.now())
    : formatRemaining(settings.workMin * 60_000);

  useEffect(() => {
    if (!docTitle || !running) return;
    const original = document.title;
    return () => {
      document.title = original;
    };
  }, [docTitle, running]);
  useEffect(() => {
    if (docTitle && running) document.title = t("dashPomodoroTitle", remaining);
  }, [docTitle, running, remaining]);

  const run = (cmd: "pomodoro.start" | "pomodoro.stop" | "pomodoro.skip") =>
    void attempt(() => send(cmd, {}));
  return (
    <Card id="pomodoro" title={t("dashPomodoro")} compact={compact}>
      <div class={s.row}>
        <div class={s.grow}>
          <div class={s.muted}>{state ? t(PHASE[state.phase]) : t("dashPomodoroIdle")}</div>
          <div class={s.timer} role="timer" aria-live="off" data-testid="pomodoro-remaining">
            {remaining}
          </div>
          {state && (
            <div class={s.muted}>
              {t("dashPomodoroRound", [state.round, Math.max(1, settings.roundsBeforeLong)])}
            </div>
          )}
        </div>
      </div>
      <div class={s.row}>
        {state ? (
          <>
            <button type="button" class={c.btn} onClick={() => run("pomodoro.stop")}>
              {t("dashPomodoroStop")}
            </button>
            <button type="button" class={c.btn} onClick={() => run("pomodoro.skip")}>
              {t("dashPomodoroSkip")}
            </button>
          </>
        ) : (
          <button
            type="button"
            class={`${c.btn} ${c.primary}`}
            onClick={() => run("pomodoro.start")}
          >
            {t("dashPomodoroStart")}
          </button>
        )}
      </div>
      {!state && <p class={s.muted}>{t("dashPomodoroEmptyHint", settings.workMin)}</p>}
    </Card>
  );
}
