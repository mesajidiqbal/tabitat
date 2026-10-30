/** WORKSPACES: inline form and the listbox of rows (popup) or cards. */
import { t } from "@/i18n";
import { newWorkspaceOpen } from "../actions";
import c from "../components/controls.module.css";
import { EmptyState } from "../components/EmptyState";
import r from "../components/rows.module.css";
import { SectionHeader } from "../components/SectionHeader";
import { WorkspaceForm } from "../components/WorkspaceForm";
import { WorkspaceRow } from "../components/WorkspaceRow";
import { useRoving } from "../hooks/useRoving";
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
  const roving = useRoving(list.length, p.onExitTop ? { onExitTop: p.onExitTop } : {});
  const panel = p.variant === "panel";
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
        <div id={WS_LIST_ID} role="listbox" aria-labelledby="ws-h" class={panel ? r.cards : r.list}>
          {list.map((m, i) => (
            <WorkspaceRow
              key={m.id}
              meta={m}
              item={roving.item(i)}
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
