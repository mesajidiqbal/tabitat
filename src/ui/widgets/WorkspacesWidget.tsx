/**
 * Workspaces widget (docs/PHASE4.md §4): cards (colour, name, tab count, open-elsewhere badge).
 * Click switches the window this page lives in (`workspace.switch`; a workspace that window
 * already shows is just kept, one open in another window is focused there). Middle-click or the
 * card menu opens it in a new window (`workspace.open`). "New" opens the inline form.
 */
import { useState } from "preact/hooks";
import { t } from "@/i18n";
import { send } from "@/messaging/client";
import { attempt } from "../actions";
import c from "../components/controls.module.css";
import { EmptyState } from "../components/EmptyState";
import r from "../components/rows.module.css";
import { WorkspaceForm } from "../components/WorkspaceForm";
import { WorkspaceRow } from "../components/WorkspaceRow";
import { useRoving } from "../hooks/useRoving";
import { IconPlus } from "../icons";
import { activeWorkspaceId, busy, liveTabCount, owners, store, workspaces } from "../store";
import { Card, type WidgetProps } from "./Card";
import s from "./widgets.module.css";

export const DASH_WS_LIST_ID = "dash-ws-list";

export function WorkspacesWidget({ compact }: WidgetProps) {
  const list = workspaces.value;
  const active = activeWorkspaceId.value;
  const own = owners.value;
  const w = store.windowId.value;
  const tabs = store.wsTabs.value;
  const liveCount = liveTabCount.value;
  const [adding, setAdding] = useState(false);
  const roving = useRoving(list.length);

  /** Middle-click on a card: open that workspace in a new window. */
  const onAux = (e: MouseEvent) => {
    if (e.button !== 1 || busy.peek()) return;
    const opt = (e.target as HTMLElement).closest('[role="row"]');
    const all = [...(e.currentTarget as HTMLElement).querySelectorAll('[role="row"]')];
    const meta = opt ? list[all.indexOf(opt)] : undefined;
    if (!meta) return;
    e.preventDefault();
    void attempt(() => send("workspace.open", { workspaceId: meta.id }));
  };

  const add = !adding && (
    <button
      type="button"
      class={`${c.btn} ${c.ghost}`}
      aria-label={t("newWorkspace")}
      onClick={() => setAdding(true)}
    >
      <IconPlus size={14} />
      {t("new")}
    </button>
  );
  return (
    <Card id="workspaces" title={t("workspaces")} compact={compact} actions={add}>
      {adding && <WorkspaceForm onClose={() => setAdding(false)} />}
      {list.length === 0 ? (
        store.ready.value && (
          <EmptyState title={t("noWorkspacesTitle")} hint={t("noWorkspacesHint")} />
        )
      ) : (
        // biome-ignore lint/a11y/useSemanticElements: ARIA grid of div rows (flex rows / cards; no table elements)
        <div
          id={DASH_WS_LIST_ID}
          role="grid"
          aria-label={t("workspaces")}
          aria-rowcount={list.length}
          class={`${r.cards} ${s.wsGrid}`}
          onMouseDown={(e) => e.button === 1 && e.preventDefault()}
          onAuxClick={onAux}
        >
          {list.map((m, i) => (
            <WorkspaceRow
              key={m.id}
              meta={m}
              item={roving.item(i)}
              rowIndex={i + 1}
              active={m.id === active}
              elsewhere={own[m.id] !== undefined && own[m.id] !== w}
              tabCount={m.id === active ? liveCount : (tabs[m.id]?.tabs.length ?? 0)}
              savedAt={tabs[m.id]?.updatedAt}
              disabled={busy.value}
              card
            />
          ))}
        </div>
      )}
    </Card>
  );
}
