/**
 * Welcome tour (docs/PHASE5.md §1): four short cards and a Done button. Opened once by the
 * worker on first install, and from Options → About. Reads storage only for the theme; the one
 * write (`system.onboarded`) goes through the worker.
 */
import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { Settings } from "@/core/model/types";
import { Keys } from "@/core/model/types";
import { t } from "@/i18n";
import { send } from "@/messaging/client";
import c from "@/ui/components/controls.module.css";
import { useStorageKey } from "@/ui/hooks/useStorageKey";
import { Logo } from "@/ui/icons";
import { applyTheme } from "@/ui/theme";
import s from "./onboarding.module.css";

export const themeOf = (raw: unknown): Settings["theme"] => {
  const theme = (raw as { theme?: unknown } | null | undefined)?.theme;
  return theme === "light" || theme === "dark" ? theme : "system";
};

const SHORTCUTS_URL = "chrome://extensions/shortcuts";

interface Shortcut {
  name: string;
  description: string;
  shortcut: string;
}

function Card(props: { id: string; title: string; children: ComponentChildren }) {
  return (
    <section class={s.card} aria-labelledby={`onb-${props.id}`} data-card={props.id}>
      <h2 id={`onb-${props.id}`}>{props.title}</h2>
      {props.children}
    </section>
  );
}

function Workspaces() {
  return (
    <Card id="workspaces" title={t("onbWsTitle")}>
      <p>{t("onbWsBody")}</p>
      <div class={s.note}>
        <strong>{t("onbWsLimitTitle")}</strong>
        <p>{t("onbWsLimit")}</p>
      </div>
    </Card>
  );
}

function WhereThingsLive() {
  return (
    <Card id="where" title={t("onbWhereTitle")}>
      <dl class={s.dl}>
        <dt>{t("onbWherePopup")}</dt>
        <dd>{t("onbWherePopupBody")}</dd>
        <dt>{t("onbWhereSidePanel")}</dt>
        <dd>{t("onbWhereSidePanelBody")}</dd>
        <dt>{t("onbWhereDashboard")}</dt>
        <dd>{t("onbWhereDashboardBody")}</dd>
      </dl>
      <p class={s.muted}>{t("onbWhereFlavor")}</p>
    </Card>
  );
}

function Shortcuts() {
  const [rows, setRows] = useState<Shortcut[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = () =>
      chrome.commands.getAll().then(
        (all) => {
          if (!alive) return;
          setRows(
            all
              // Chrome adds `_execute_action` (open the popup): not one of Tabitat's commands.
              .filter((cmd) => !cmd.name?.startsWith("_"))
              .map((cmd) => ({
                name: cmd.name ?? "",
                description: cmd.description ?? "",
                shortcut: cmd.shortcut ?? "",
              })),
          );
          setFailed(false);
        },
        () => alive && setFailed(true),
      );
    void load();
    // Shortcuts are changed on Chrome's page in another tab: refresh on return.
    const onVisible = () => document.visibilityState === "visible" && void load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return (
    <Card id="shortcuts" title={t("onbKeysTitle")}>
      <p>{t("onbKeysLead")}</p>
      {failed && (
        <p class={s.error} role="alert">
          {t("optShortcutsFailed")}
        </p>
      )}
      {rows && rows.length === 0 && <p class={s.muted}>{t("optShortcutsEmpty")}</p>}
      {rows && rows.length > 0 && (
        <table class={s.table}>
          <thead>
            <tr>
              <th scope="col">{t("optColCommand")}</th>
              <th scope="col">{t("optColShortcut")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name} data-command={r.name}>
                <td>{r.description || r.name}</td>
                <td>
                  {r.shortcut ? (
                    <kbd class={c.kbd}>{r.shortcut}</kbd>
                  ) : (
                    <span class={s.muted}>{t("optShortcutNotSet")}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <button
        type="button"
        class={c.btn}
        onClick={() => void chrome.tabs.create({ url: SHORTCUTS_URL })}
      >
        {t("optShortcutsChange")}
      </button>
    </Card>
  );
}

function Privacy() {
  return (
    <Card id="privacy" title={t("onbPrivacyTitle")}>
      <ul class={s.list}>
        <li>{t("onbPrivacyLocal")}</li>
        <li>{t("onbPrivacyNetwork")}</li>
        <li>{t("onbPrivacySync")}</li>
        <li>{t("onbPrivacyBackups")}</li>
      </ul>
    </Card>
  );
}

/** Closes the tab; if the browser refuses (not script-opened), goes to the dashboard instead. */
function leave(): void {
  window.close();
  setTimeout(() => location.assign(chrome.runtime.getURL("/dashboard.html")), 250);
}

export function App() {
  const settings = useStorageKey(Keys.settings).value;
  useEffect(() => applyTheme(themeOf(settings)), [settings]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const done = async () => {
    setBusy(true);
    setFailed(false);
    try {
      await send("system.onboarded", {});
      leave();
    } catch {
      setFailed(true);
      setBusy(false);
    }
  };

  return (
    <main class={s.page}>
      <header class={s.top}>
        <Logo size={32} />
        <div>
          <h1>{t("onbTitle")}</h1>
          <p class={s.muted}>{t("onbLead")}</p>
        </div>
      </header>
      <div class={s.cards}>
        <Workspaces />
        <WhereThingsLive />
        <Shortcuts />
        <Privacy />
      </div>
      <footer class={s.footer}>
        {failed && (
          <p class={s.error} role="alert">
            {t("onbDoneFailed")}
          </p>
        )}
        <button
          type="button"
          class={`${c.btn} ${c.primary} ${s.done}`}
          disabled={busy}
          onClick={() => void done()}
        >
          {t("onbDone")}
        </button>
        <p class={s.muted}>{t("onbDoneHint")}</p>
      </footer>
    </main>
  );
}
