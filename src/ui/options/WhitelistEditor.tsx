/**
 * Never-suspend list: one host per line plus rendered chips. Valid lines are saved 300 ms after
 * the last keystroke as the normalized, unique list; invalid lines are flagged and not saved;
 * more than LIMITS.whitelistHosts hosts saves nothing.
 */
import { useEffect, useId, useMemo, useRef, useState } from "preact/hooks";
import { LIMITS } from "@/core/model/types";
import { t } from "@/i18n";
import s from "./options.module.css";
import { useSettingsApi } from "./SettingsContext";
import { parseWhitelist, whitelistText } from "./whitelist";

export function WhitelistEditor() {
  const { settings, update } = useSettingsApi();
  const stored = settings.suspend.whitelist;
  const id = useId();
  const [text, setText] = useState(whitelistText(stored));
  const area = useRef<HTMLTextAreaElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const parsed = useMemo(() => parseWhitelist(text), [text]);
  const storedKey = stored.join("\n");

  // Another surface changed the list: show it unless the user is typing here.
  useEffect(() => {
    if (document.activeElement !== area.current) setText(storedKey);
  }, [storedKey]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const edit = (v: string) => {
    setText(v);
    clearTimeout(timer.current);
    const p = parseWhitelist(v);
    if (p.overLimit || p.hosts.join("\n") === storedKey) return;
    timer.current = setTimeout(
      () => void update("suspension", { suspend: { whitelist: p.hosts } }),
      300,
    );
  };

  return (
    <div class={s.field}>
      <label class={s.label} for={id}>
        {t("optWhitelist")}
      </label>
      <p class={s.hint} id={`${id}-h`}>
        {t("optWhitelistHint")}
      </p>
      <textarea
        id={id}
        ref={area}
        class={s.textarea}
        rows={6}
        spellcheck={false}
        autocapitalize="off"
        autocomplete="off"
        placeholder="example.com"
        value={text}
        aria-describedby={`${id}-h ${id}-e`}
        onInput={(e) => edit((e.currentTarget as HTMLTextAreaElement).value)}
      />
      <div id={`${id}-e`} aria-live="polite">
        {parsed.invalid.map((l) => (
          <p key={l.line} class={s.err}>
            {t("optWhitelistBad", [l.line, l.text])}
          </p>
        ))}
        {parsed.overLimit && <p class={s.err}>{t("optWhitelistTooMany", LIMITS.whitelistHosts)}</p>}
      </div>
      {parsed.hosts.length === 0 ? (
        <p class={s.hint}>{t("optWhitelistEmpty")}</p>
      ) : (
        <ul class={s.list} aria-label={t("optWhitelistChips")}>
          {parsed.hosts.map((h) => (
            <li key={h} class={s.chip}>
              {h}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
