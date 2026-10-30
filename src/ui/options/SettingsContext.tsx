/**
 * Options page settings model. Reads `settings` with useStorageKey and writes only through
 * `send("settings.update", { patch, expectedRev })`. Writes run one at a time in call order;
 * each patch remembers the rev it was made against, and a patch that a change from elsewhere
 * has overtaken (`shouldSend`) is not sent. A stale patch or a `conflict` drops every queued
 * patch, reloads from storage and shows a notice (and remounts the sections, so any text draft
 * is dropped); other failures show an error line.
 */
import { type ComponentChildren, createContext } from "preact";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { DEFAULT_SETTINGS, Keys, type Settings } from "@/core/model/types";
import { t } from "@/i18n";
import { send } from "@/messaging/client";
import type { CommandIn } from "@/messaging/commands";
import { useStorageKey } from "../hooks/useStorageKey";
import { type ErrorLine, errorLine, isConflict } from "./errors";
import { parseSettingsLoose, shouldSend } from "./settings";

/** Nested objects are merged by the worker, so a patch names only the fields it changes. */
export interface SettingsPatch {
  theme?: Settings["theme"];
  suspend?: Partial<Settings["suspend"]>;
  sessions?: Partial<Settings["sessions"]>;
  pomodoro?: Partial<Settings["pomodoro"]>;
  dashboard?: Partial<Settings["dashboard"]>;
  syncSettings?: boolean;
  restoreLimit?: number;
  backupReminderDays?: number;
}

export interface SettingsApi {
  settings: Settings;
  /**
   * Saves `patch`; `section` is the id whose "Saved" indicator flashes. `baseRev`: the rev the
   * patch was drafted against (default: the latest known rev now). Resolves true on success.
   */
  update: (section: string, patch: SettingsPatch, baseRev?: number) => Promise<boolean>;
  /** Section whose "Saved" indicator is showing. */
  saved: string | null;
  notice: string | null;
  error: ErrorLine | null;
  /** Bumped on a conflict reload: sections are keyed by it and remount. */
  epoch: number;
  dismiss: () => void;
}

const Ctx = createContext<SettingsApi | null>(null);

/** The raw context (tests provide a fake api through it). */
export const SettingsApiContext = Ctx;

export function useSettingsApi(): SettingsApi {
  const api = useContext(Ctx);
  if (!api) throw new Error("SettingsProvider missing");
  return api;
}

const SAVED_MS = 2000;

export function SettingsProvider({ children }: { children?: ComponentChildren }) {
  const stored = useStorageKey<Settings>(Keys.settings, parseSettingsLoose);
  const settings = stored.value ?? DEFAULT_SETTINGS;
  const [saved, setSaved] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<ErrorLine | null>(null);
  const [epoch, setEpoch] = useState(0);
  const rev = useRef(settings.rev);
  /** Rev of our own last acknowledged write (revs up to it are not "changed elsewhere"). */
  const acked = useRef(-1);
  /** Bumped when the queue is dropped: patches queued under an older value are discarded. */
  const queueGen = useRef(0);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const savedTimer = useRef<ReturnType<typeof setTimeout>>();
  // The echo of our own write can lag behind the reply: never move the known rev backwards.
  rev.current = Math.max(rev.current, settings.rev);

  useEffect(() => () => clearTimeout(savedTimer.current), []);

  const reload = useCallback(async () => {
    queueGen.current++;
    try {
      const res = await chrome.storage.local.get(Keys.settings);
      rev.current = parseSettingsLoose(res[Keys.settings]).rev;
    } catch {
      // the storage listener still delivers the current record
    }
    setEpoch((n) => n + 1);
    setNotice(t("optConflict"));
  }, []);

  const update = useCallback(
    (section: string, patch: SettingsPatch, draftRev?: number) => {
      const baseRev = draftRev ?? rev.current;
      const gen = queueGen.current;
      const run = async (): Promise<boolean> => {
        if (gen !== queueGen.current) return false; // dropped by a conflict
        if (!shouldSend(baseRev, acked.current, rev.current)) {
          await reload();
          return false;
        }
        try {
          const out = await send("settings.update", {
            patch: patch as CommandIn<"settings.update">["patch"],
            expectedRev: rev.current,
          });
          acked.current = out.rev;
          rev.current = Math.max(rev.current, out.rev);
          setError(null);
          setSaved(section);
          clearTimeout(savedTimer.current);
          savedTimer.current = setTimeout(() => setSaved(null), SAVED_MS);
          return true;
        } catch (e) {
          if (isConflict(e)) await reload();
          else setError(errorLine(e));
          return false;
        }
      };
      const next = queue.current.then(run, run);
      queue.current = next;
      return next;
    },
    [reload],
  );

  const api = useMemo<SettingsApi>(
    () => ({
      settings,
      update,
      saved,
      notice,
      error,
      epoch,
      dismiss: () => {
        setNotice(null);
        setError(null);
      },
    }),
    [settings, update, saved, notice, error, epoch],
  );

  if (!stored.loaded) return null;
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}
