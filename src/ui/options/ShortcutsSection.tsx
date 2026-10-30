/** Shortcuts are owned by Chrome: this lists them (`chrome.commands.getAll`) and links out. */
import { useEffect, useState } from "preact/hooks";
import { t } from "@/i18n";
import c from "../components/controls.module.css";
import { Group, Section } from "./fields";
import s from "./options.module.css";

interface Row {
  name: string;
  description: string;
  shortcut: string;
}

async function loadCommands(): Promise<Row[]> {
  const all = await chrome.commands.getAll();
  return all.map((cmd) => ({
    name: cmd.name ?? "",
    description: cmd.description ?? "",
    shortcut: cmd.shortcut ?? "",
  }));
}

export function ShortcutsSection() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () =>
      loadCommands().then(
        (r) => {
          if (!alive) return;
          setRows(r);
          setFailed(false);
        },
        () => {
          if (alive) setFailed(true);
        },
      );
    void load();
    // The shortcuts page is edited in another tab: refresh when the user comes back.
    const onVisible = () => document.visibilityState === "visible" && void load();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, []);

  return (
    <Section id="shortcuts" title={t("optShortcuts")} lead={t("optShortcutsLead")}>
      <Group>
        {failed && (
          <p class={`${s.notice} ${s.bad}`} role="alert">
            {t("optShortcutsFailed")}
          </p>
        )}
        {rows && rows.length === 0 && <p class={s.hint}>{t("optShortcutsEmpty")}</p>}
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
                      <kbd class={s.key}>{r.shortcut}</kbd>
                    ) : (
                      <span class={s.muted}>{t("optShortcutNotSet")}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div class={s.row}>
          <button
            type="button"
            class={c.btn}
            onClick={() => void chrome.tabs.create({ url: "chrome://extensions/shortcuts" })}
          >
            {t("optShortcutsChange")}
          </button>
        </div>
      </Group>
    </Section>
  );
}
