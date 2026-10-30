/**
 * Developer popup (Phase 1): drives the engine. Reads storage via useStorageKey, writes only
 * through RPC `send()`. Deliberately unstyled. Open it in a tab ("Open in tab") for file import:
 * the popup closes when a file chooser opens on some platforms.
 */
import { useEffect, useState } from "preact/hooks";
import type { RecoveryPending } from "@/background/keys";
import type {
  Color,
  SessionGeneration,
  SwitchOp,
  WindowState,
  WorkspaceMeta,
  WorkspaceTabs,
} from "@/core/model/types";
import { Keys } from "@/core/model/types";
import { send } from "@/messaging/client";
import { useStorageKey } from "@/ui/hooks/useStorageKey";

const COLORS: Color[] = [
  "grey",
  "blue",
  "red",
  "yellow",
  "green",
  "pink",
  "purple",
  "cyan",
  "orange",
];

function useCurrentWindowId(): number | null {
  const [id, setId] = useState<number | null>(null);
  useEffect(() => {
    const fromQuery = Number(new URLSearchParams(location.search).get("window"));
    if (Number.isInteger(fromQuery) && fromQuery > 0) {
      setId(fromQuery);
      return;
    }
    void chrome.windows.getCurrent().then((w) => setId(w.id ?? null));
  }, []);
  return id;
}

type Run = (label: string, fn: () => Promise<unknown>) => void;

function WorkspaceRow(props: {
  id: string;
  activeId: string | null;
  windowId: number | null;
  run: Run;
}) {
  const meta = useStorageKey<WorkspaceMeta>(Keys.wsMeta(props.id)).value;
  const tabs = useStorageKey<WorkspaceTabs>(Keys.wsTabs(props.id)).value;
  if (!meta) return null;
  const active = props.activeId === props.id;
  const { windowId, run } = props;
  return (
    <li>
      <b>{active ? "▶ " : ""}</b>
      {meta.emoji ?? ""} {meta.name}{" "}
      <small>
        ({meta.kind}, {meta.color}, {tabs?.tabs.length ?? 0} tabs, {meta.resources.length} links)
      </small>{" "}
      <button
        type="button"
        disabled={active || windowId === null}
        onClick={() =>
          windowId !== null &&
          run(`switch to ${meta.name}`, () =>
            send("workspace.switch", { windowId, workspaceId: props.id }),
          )
        }
      >
        Switch
      </button>
      <button
        type="button"
        onClick={() =>
          run(`open ${meta.name}`, () => send("workspace.open", { workspaceId: props.id }))
        }
      >
        Open in new window
      </button>
      <button
        type="button"
        onClick={() => run(`delete ${meta.name}`, () => send("workspace.delete", { id: props.id }))}
      >
        Delete
      </button>
    </li>
  );
}

function GenerationRow(props: { n: number; run: Run }) {
  const gen = useStorageKey<SessionGeneration>(Keys.sessionGen(props.n)).value;
  if (!gen) return null;
  const tabs = gen.windows.reduce((s, w) => s + w.tabs.length, 0);
  return (
    <li>
      #{gen.id} {new Date(gen.takenAt).toLocaleString()} — {gen.windows.length} windows, {tabs} tabs{" "}
      <button
        type="button"
        onClick={() =>
          props.run(`restore #${gen.id}`, () => send("session.restore", { generation: gen.id }))
        }
      >
        Restore
      </button>
    </li>
  );
}

function OpStatus(props: { op: SwitchOp | undefined }) {
  const op = props.op;
  if (!op) return null;
  return (
    <p>
      <b>Switch in progress:</b> {op.from ?? "(none)"} → {op.to}, stage <code>{op.stage}</code>,{" "}
      {Object.keys(op.createdTabIds).length}/{op.incoming.length} created, attempts {op.attempts}
    </p>
  );
}

export function App() {
  const windowId = useCurrentWindowId();
  const [log, setLog] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [color, setColor] = useState<Color>("blue");
  const [mode, setMode] = useState<"merge" | "replace">("merge");
  const [showRecover, setShowRecover] = useState(false);

  const index = useStorageKey<string[]>(Keys.wsIndex).value ?? [];
  const winState = useStorageKey<WindowState>(
    windowId === null ? null : Keys.window(windowId),
  ).value;
  const op = useStorageKey<SwitchOp>(windowId === null ? null : Keys.opSwitch(windowId)).value;
  const recovery = useStorageKey<RecoveryPending>("recovery:pending").value;
  const sessions = useStorageKey<number[]>(Keys.sessionsIndex).value ?? [];
  const activeId = winState?.activeWorkspaceId ?? null;
  const activeMeta = useStorageKey<WorkspaceMeta>(activeId ? Keys.wsMeta(activeId) : null).value;

  const run: Run = (label, fn) => {
    setLog((l) => [`… ${label}`, ...l].slice(0, 20));
    fn().then(
      (res) =>
        setLog((l) =>
          [`✔ ${label}: ${JSON.stringify(res)?.slice(0, 200) ?? "ok"}`, ...l].slice(0, 20),
        ),
      (e: unknown) =>
        setLog((l) =>
          [`✘ ${label}: ${e instanceof Error ? e.message : String(e)}`, ...l].slice(0, 20),
        ),
    );
  };

  const exportJson = () =>
    run("export", async () => {
      const file = await send("backup.export", {});
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(file, null, 2)], { type: "application/json" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = `tabitat-backup-${new Date(file.exportedAt).toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      return { workspaces: file.data.workspaces.length };
    });

  const importJson = (ev: Event) => {
    const input = ev.currentTarget as HTMLInputElement;
    const f = input.files?.[0];
    if (!f) return;
    run(`import (${mode})`, async () => {
      const file: unknown = JSON.parse(await f.text());
      return send("backup.import", { file, mode });
    });
    input.value = "";
  };

  return (
    <main style={{ minWidth: "420px", fontFamily: "system-ui", fontSize: "12px" }}>
      <h3>Tabitat (dev)</h3>
      <p>
        Window {windowId ?? "?"} — active workspace:{" "}
        <b>{activeMeta ? `${activeMeta.name} (${activeMeta.kind})` : "none"}</b>
      </p>
      <OpStatus op={op} />
      {recovery && recovery.entries.length > 0 && (
        <p style={{ color: "darkred" }}>
          <b>Recovery pending:</b>{" "}
          {recovery.entries
            .map((e) => `${e.from ?? "∅"}→${e.to} (${e.reason}, ${e.incoming.length} tabs)`)
            .join("; ")}
        </p>
      )}

      <fieldset>
        <legend>New workspace from this window</legend>
        <input placeholder="name" value={name} onInput={(e) => setName(e.currentTarget.value)} />
        <select value={color} onChange={(e) => setColor(e.currentTarget.value as Color)}>
          {COLORS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={name.trim() === "" || windowId === null}
          onClick={() => {
            if (windowId === null) return;
            run(`create ${name}`, () =>
              send("workspace.create", { name: name.trim(), color, fromWindowId: windowId }),
            );
            setName("");
          }}
        >
          Create from window
        </button>
        <button
          type="button"
          disabled={name.trim() === ""}
          onClick={() => {
            run(`create empty ${name}`, () =>
              send("workspace.create", { name: name.trim(), color }),
            );
            setName("");
          }}
        >
          Create empty
        </button>
      </fieldset>

      <h4>Workspaces ({index.length})</h4>
      <ul>
        {index.map((id) => (
          <WorkspaceRow key={id} id={id} activeId={activeId} windowId={windowId} run={run} />
        ))}
      </ul>

      <p>
        <button
          type="button"
          onClick={() => run("snapshot now", () => send("session.snapshotNow", {}))}
        >
          Snapshot now
        </button>{" "}
        <button type="button" onClick={exportJson}>
          Export JSON
        </button>{" "}
        <label>
          Import JSON{" "}
          <select
            value={mode}
            onChange={(e) => setMode(e.currentTarget.value as "merge" | "replace")}
          >
            <option value="merge">merge</option>
            <option value="replace">replace</option>
          </select>{" "}
          <input type="file" accept="application/json,.json" onChange={importJson} />
        </label>{" "}
        <button type="button" onClick={() => setShowRecover((x) => !x)}>
          Recover…
        </button>{" "}
        <button
          type="button"
          onClick={() =>
            void chrome.tabs.create({
              url: chrome.runtime.getURL(`/popup.html${windowId ? `?window=${windowId}` : ""}`),
            })
          }
        >
          Open in tab
        </button>{" "}
        <button
          type="button"
          onClick={() =>
            windowId !== null && run("op.status", () => send("op.status", { windowId }))
          }
        >
          op.status
        </button>
      </p>

      {showRecover && (
        <>
          <h4>Session generations ({sessions.length})</h4>
          <ul>
            {[...sessions].reverse().map((n) => (
              <GenerationRow key={n} n={n} run={run} />
            ))}
          </ul>
        </>
      )}

      <h4>Log</h4>
      <pre style={{ whiteSpace: "pre-wrap" }}>{log.join("\n")}</pre>
    </main>
  );
}
