/**
 * Pomodoro widget (docs/PHASE4.md §4): reads the `pomodoro` key, ticks every second from `endsAt`
 * (no worker calls), Start / Stop / Skip -> pomodoro.start|stop|skip. With `docTitle` (the
 * dashboard) the page title shows "mm:ss · Tabitat" while running and is restored after.
 * The second tick pauses while the page is hidden (refreshed when it shows again); phase,
 * round, start and stop changes are announced in a separate polite status region.
 */
import { useEffect, useRef, useState } from "preact/hooks";
import { DEFAULT_SETTINGS, type PomodoroPhase } from "@/core/model/types";
import { type MsgKey, t } from "@/i18n";
import { send } from "@/messaging/client";
import { attempt } from "../actions";
import c from "../components/controls.module.css";
import { store } from "../store";
import { Card, Skeleton, type WidgetProps } from "./Card";
import { records } from "./records";
import { formatRemaining } from "./time";
import s from "./widgets.module.css";

const PHASE: Record<PomodoroPhase, MsgKey> = {
  work: "dashPomodoroWork",
  break: "dashPomodoroBreak",
  longBreak: "dashPomodoroLongBreak",
};

export function Pomodoro({ compact, docTitle }: WidgetProps & { docTitle?: boolean }) {
  const state = records.pomodoro.value;
  const settings = store.settings.value.pomodoro ?? DEFAULT_SETTINGS.pomodoro;
  // Re-render every second while running; the remaining time is always computed from now.
  const [, setTick] = useState(0);
  const running = state !== null;

  useEffect(() => {
    if (!running) return;
    const tick = () => setTick((n) => n + 1);
    let id: ReturnType<typeof setInterval> | undefined;
    const schedule = () => {
      clearInterval(id);
      id = document.hidden ? undefined : setInterval(tick, 1000);
    };
    const onVisibility = () => {
      if (!document.hidden) tick();
      schedule();
    };
    schedule();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [running]);

  // Transitions only (not the initial state): "Work · round 2 of 4", "Pomodoro stopped".
  const rounds = Math.max(1, settings.roundsBeforeLong);
  const phaseKey = state ? `${state.phase}:${state.round}` : "";
  const lastPhase = useRef(phaseKey);
  const [announce, setAnnounce] = useState("");
  useEffect(() => {
    if (lastPhase.current === phaseKey) return;
    lastPhase.current = phaseKey;
    setAnnounce(
      state
        ? t("dashPomodoroAnnounce", [t(PHASE[state.phase]), state.round, rounds])
        : t("dashPomodoroStopped"),
    );
  }, [phaseKey]);

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
      {records.pomodoroLoaded.value ? (
        <>
          <div class={s.row}>
            <div class={s.grow}>
              <div class={s.muted}>{state ? t(PHASE[state.phase]) : t("dashPomodoroIdle")}</div>
              <div class={s.timer} role="timer" aria-live="off" data-testid="pomodoro-remaining">
                {remaining}
              </div>
              {state && <div class={s.muted}>{t("dashPomodoroRound", [state.round, rounds])}</div>}
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
        </>
      ) : (
        <Skeleton small />
      )}
      <p class="sr-only" role="status" aria-live="polite" data-testid="pomodoro-status">
        {announce}
      </p>
    </Card>
  );
}
