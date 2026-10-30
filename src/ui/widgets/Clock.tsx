/** Clock widget: locale time (12/24 h from the locale), date and a greeting by local hour. */
import { useEffect, useState } from "preact/hooks";
import { t } from "@/i18n";
import type { WidgetProps } from "./Card";
import { greetingKey, msToNextMinute } from "./time";
import s from "./widgets.module.css";

let timeFmt: Intl.DateTimeFormat | null = null;
let dateFmt: Intl.DateTimeFormat | null = null;

export function Clock({ compact }: WidgetProps) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let id: ReturnType<typeof setTimeout>;
    const tick = () => {
      setNow(new Date());
      id = setTimeout(tick, msToNextMinute(Date.now()));
    };
    id = setTimeout(tick, msToNextMinute(Date.now()));
    return () => clearTimeout(id);
  }, []);
  timeFmt ??= new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
  dateFmt ??= new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  return (
    <section class={`${s.card} ${s.clock}`} aria-label={t("dashClock")} data-widget="clock">
      <time class={s.time} dateTime={now.toISOString()}>
        {timeFmt.format(now)}
      </time>
      {!compact && <span class={s.date}>{dateFmt.format(now)}</span>}
      <span class={s.muted}>{t(greetingKey(now.getHours()))}</span>
    </section>
  );
}
