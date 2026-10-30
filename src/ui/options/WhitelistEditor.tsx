/**
 * Never-suspend list: one host per line plus rendered chips. The normalized, unique list is
 * saved 300 ms after the last keystroke, on blur and when the editor unmounts (section
 * navigation). While any line is invalid, or there are more than LIMITS.whitelistHosts hosts,
 * nothing is saved: the stored list stays as it was and the textarea is marked invalid.
 */
import { useEffect, useId, useMemo, useRef, useState } from "preact/hooks";
import { LIMITS } from "@/core/model/types";
import { t } from "@/i18n";
import s from "./options.module.css";
import { useSettingsApi } from "./SettingsContext";
import { parseWhitelist, whitelistText } from "./whitelist";

interface Draft {
  hosts: string[];
  /** Settings rev the draft started from (a change from elsewhere after it makes it stale). */
  baseRev: number;
}

export function WhitelistEditor() {
  const { settings, update } = useSettingsApi();
  const stored = settings.suspend.whitelist;
  const id = useId();
  const [text, setText] = useState(whitelistText(stored));
  const area = useRef<HTMLTextAreaElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const pending = useRef<Draft | null>(null);
  const draftRev = useRef<number | null>(null);
  const parsed = useMemo(() => parseWhitelist(text), [text]);
  const storedKey = stored.join("\n");
  const flushRef = useRef<() => void>(() => undefined);

  const flush = () => {
    clearTimeout(timer.current);
    const d = pending.current;
    pending.current = null;
    draftRev.current = null;
    if (d) void update("suspension", { suspend: { whitelist: d.hosts } }, d.baseRev);
  };
  flushRef.current = flush;

  // Another surface changed the list: show it unless the user is typing here.
  useEffect(() => {
    if (document.activeElement === area.current) return;
    setText(storedKey);
    draftRev.current = null;
  }, [storedKey]);
  // Leaving the section within the debounce still saves the draft.
  useEffect(() => () => flushRef.current(), []);

  const edit = (v: string) => {
    setText(v);
    clearTimeout(timer.current);
    if (draftRev.current === null) draftRev.current = settings.rev;
    const p = parseWhitelist(v);
    if (p.overLimit || p.invalid.length > 0) {
      pending.current = null;
      return;
    }
    if (p.hosts.join("\n") === storedKey) {
      pending.current = null;
      draftRev.current = null; // back to the stored list: no draft
      return;
    }
    pending.current = { hosts: p.hosts, baseRev: draftRev.current };
    timer.current = setTimeout(flush, 300);
  };

  const invalid = parsed.invalid.length > 0 || parsed.overLimit;
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
        class={`${s.textarea} ${invalid ? s.invalid : ""}`}
        rows={6}
        spellcheck={false}
        autocapitalize="off"
        autocomplete="off"
        placeholder="example.com"
        value={text}
        aria-invalid={invalid ? "true" : undefined}
        aria-describedby={`${id}-h ${id}-e`}
        onInput={(e) => edit((e.currentTarget as HTMLTextAreaElement).value)}
        onBlur={flush}
      />
      <div id={`${id}-e`} aria-live="polite">
        {parsed.invalid.map((l) => (
          <p key={l.line} class={s.err}>
            {t("optWhitelistBad", [l.line, l.text])}
          </p>
        ))}
        {parsed.invalid.length > 0 && <p class={s.err}>{t("optWhitelistBlocked")}</p>}
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
