/**
 * WORKSPACES: inline form and the grid of rows (popup) or cards (side panel; arrows move between
 * cards in two dimensions). When the last row goes, focus moves to the search box.
 */
import { t } from "@/i18n";
import { newWorkspaceOpen } from "../actions";
import c from "../components/controls.module.css";
import { EmptyState } from "../components/EmptyState";
import r from "../components/rows.module.css";
import { SectionHeader } from "../components/SectionHeader";
import { WorkspaceForm } from "../components/WorkspaceForm";
import { WorkspaceRow } from "../components/WorkspaceRow";
import { focusFirst, gridColumns, useRoving } from "../hooks/useRoving";
import { IconPlus } from "../icons";
import { activeWorkspaceId, busy, liveTabCount, owners, store, workspaces } from "../store";
import s from "./sections.module.css";

export const WS_LIST_ID = "ws-list";

export function WorkspacesSection(p: { variant: "popup" | "panel"; onExitTop?: () => void }) {
  const list = workspaces.value;
  const active = activeWorkspaceId.value;
  const own = owners.value;
  const w = store.windowId.value;
  const tabs = store.wsTabs.value;
  const liveCount = liveTabCount.value;
  const ready = store.ready.value;
  const panel = p.variant === "panel";
  const roving = useRoving(list.length, {
    ...(p.onExitTop ? { onExitTop: p.onExitTop } : {}),
    onEmpty: p.onExitTop ?? (() => focusFirst("ws-h")),
    // Side panel cards wrap into columns: arrows move in two dimensions (C3.3).
    ...(panel ? { columns: () => gridColumns(document.getElementById(WS_LIST_ID)) } : {}),
  });
  return (
    <section class={s.section} aria-labelledby="ws-h">
      <SectionHeader id="ws-h" title={t("workspaces")} count={list.length} sticky={panel}>
        <button
          type="button"
          class={`${c.btn} ${c.ghost} ${s.addBtn}`}
          aria-keyshortcuts="n"
          aria-expanded={newWorkspaceOpen.value}
          onClick={() => (newWorkspaceOpen.value = !newWorkspaceOpen.value)}
        >
          <IconPlus size={14} />
          {t("new")}
        </button>
      </SectionHeader>
      {newWorkspaceOpen.value && <WorkspaceForm onClose={() => (newWorkspaceOpen.value = false)} />}
      {list.length === 0 ? (
        ready && <EmptyState title={t("noWorkspacesTitle")} hint={t("noWorkspacesHint")} />
      ) : (
        // biome-ignore lint/a11y/useSemanticElements: ARIA grid of div rows (flex rows / cards; no table elements)
        <div
          id={WS_LIST_ID}
          role="grid"
          aria-labelledby="ws-h"
          aria-rowcount={list.length}
          class={panel ? r.cards : r.list}
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
              shortcut={i < 9 ? i + 1 : undefined}
              disabled={busy.value}
              card={panel}
            />
          ))}
        </div>
      )}
    </section>
  );
}
