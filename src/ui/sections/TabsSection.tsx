/**
 * TABS IN THIS WINDOW: live tabs grouped by tab group; activate / close (undo) / park / suspend.
 * "Duplicates (N)" filters to duplicate groups (kept tab first). Rows drag onto Saved links.
 */
import { useState } from "preact/hooks";
import { hostOf, schemeOf } from "@/core/ops/url";
import { isWhitelisted } from "@/core/suspend/rules";
import { t } from "@/i18n";
import { activateTab } from "../actions";
import c from "../components/controls.module.css";
import { Menu } from "../components/Menu";
import r from "../components/rows.module.css";
import { SectionHeader } from "../components/SectionHeader";
import { TabGroupHeader } from "../components/TabGroupHeader";
import { type RowAction, TabRow } from "../components/TabRow";
import { focusFirst, useRoving } from "../hooks/useRoving";
import { IconClose, IconDupes, IconMore, IconPark, IconSleep } from "../icons";
import {
  activeWorkspaceId,
  busy,
  duplicateGroups,
  duplicateIds,
  store,
  windowDuplicates,
} from "../store";
import {
  closeDuplicates,
  closeTab,
  parkTab,
  suspendTab,
  TAB_DRAG_TYPE,
  toggleSiteWhitelist,
} from "../tabActions";
import { buildTabNodes, canSuspend, type TabRun, tabRuns, type UiTab } from "../tabs";
import { colorVar } from "../theme";
import s from "./sections.module.css";
import { WindowActions } from "./WindowActions";

function rowActions(tab: UiTab, ws: string | null): RowAction[] {
  const actions: RowAction[] = [
    {
      label: t("closeTab"),
      icon: <IconClose size={14} />,
      run: () => void closeTab(tab),
      del: true,
    },
  ];
  if (ws && !tab.pinned) {
    const run = () => void parkTab(tab.id, ws);
    actions.push({ label: t("parkTab"), icon: <IconPark size={14} />, run, key: "p" });
  }
  if (canSuspend(tab)) {
    const run = () => void suspendTab(tab.id);
    actions.push({ label: t("suspendTab"), icon: <IconSleep size={14} />, run, key: "z" });
  }
  const scheme = schemeOf(tab.url);
  const host = scheme === "http:" || scheme === "https:" ? hostOf(tab.url) : null;
  if (host) {
    const listed = isWhitelisted(host, store.settings.value.suspend.whitelist);
    actions.push({
      label: t(listed ? "allowSuspendSite" : "neverSuspendSite"),
      icon: <IconSleep size={14} />,
      run: () => void toggleSiteWhitelist(host),
      menuOnly: true,
    });
  }
  return actions;
}

export function TabsSection(p: { variant: "popup" | "panel" }) {
  const tabs = store.liveTabs.value;
  const ws = activeWorkspaceId.value;
  const dupes = windowDuplicates.value;
  const extras = duplicateIds.value;
  const [collapsed, setCollapsed] = useState<Record<number, boolean>>({});
  const [onlyDupes, setOnlyDupes] = useState(false);
  const filtering = onlyDupes && dupes > 0;
  const runs: TabRun[] = filtering
    ? [{ group: null, groupId: -1, tabs: duplicateGroups.value.flat() }]
    : tabRuns(tabs, store.groups.value);
  const nodes = buildTabNodes(runs, collapsed);
  const tabPos = new Map<number, number>();
  const headerPos = new Map<number, number>();
  nodes.forEach((n, i) => {
    if (n.kind === "tab") tabPos.set(n.tab.id, i);
    else headerPos.set(n.groupId, i);
  });
  const roving = useRoving(nodes.length, { onEmpty: () => focusFirst("tabs-h") });
  const disabled = busy.value;
  const panel = p.variant === "panel";

  const row = (tab: UiTab, inGroup: boolean) => (
    <TabRow
      key={tab.id}
      title={tab.title}
      url={tab.url}
      item={roving.item(tabPos.get(tab.id) ?? -1)}
      rowIndex={(tabPos.get(tab.id) ?? -1) + 1}
      onOpen={() => void activateTab(tab.id, tab.windowId)}
      actions={rowActions(tab, ws)}
      current={tab.active}
      pinned={tab.pinned}
      suspended={tab.placeholder || tab.discarded}
      suspendedHint={tab.discarded ? t("suspendedTooltip") : undefined}
      chip={extras.has(tab.id) ? t("duplicate") : undefined}
      showHost={panel}
      inGroup={inGroup}
      disabled={disabled}
      onDragStart={
        ws && !tab.pinned
          ? (e) => {
              e.dataTransfer?.setData(TAB_DRAG_TYPE, String(tab.id));
              if (e.dataTransfer) e.dataTransfer.effectAllowed = "copyMove";
            }
          : undefined
      }
    />
  );

  return (
    <section class={s.section} aria-labelledby="tabs-h">
      <SectionHeader id="tabs-h" title={t("tabsInWindow")} count={tabs.length} sticky={panel}>
        {dupes > 0 && (
          <button
            type="button"
            class={`${c.btn} ${c.ghost} ${s.addBtn} ${s.filterBtn}`}
            aria-pressed={filtering}
            onClick={() => setOnlyDupes(!filtering)}
          >
            <IconDupes size={14} />
            {t("duplicatesFilter", dupes)}
          </button>
        )}
        {panel && (
          <Menu
            label={t("tabsMenu")}
            trigger={<IconMore size={14} />}
            triggerClass={`${c.iconBtn} ${s.menuBtn}`}
            disabled={disabled}
            items={[
              { label: t("closeDupesAllWindows"), onSelect: () => void closeDuplicates(true) },
            ]}
          />
        )}
      </SectionHeader>
      {panel && (
        <div class={s.toolbar}>
          <WindowActions />
        </div>
      )}
      {/* biome-ignore lint/a11y/useSemanticElements: ARIA grid of div rows (flex rows; no table elements) */}
      <div role="grid" aria-labelledby="tabs-h" aria-rowcount={nodes.length} class={r.list}>
        {runs.map((run) =>
          run.group ? (
            // biome-ignore lint/a11y/useSemanticElements: ARIA rowgroup of a div grid (no table)
            <div
              key={`g${run.groupId}`}
              role="rowgroup"
              aria-labelledby={`grp-${run.groupId}`}
              class={r.group}
              style={{ "--dot": colorVar(run.group.color) }}
            >
              <TabGroupHeader
                id={`grp-${run.groupId}`}
                group={run.group}
                count={run.tabs.length}
                collapsed={collapsed[run.groupId] === true}
                item={roving.item(headerPos.get(run.groupId) ?? -1)}
                rowIndex={(headerPos.get(run.groupId) ?? -1) + 1}
                onToggle={() =>
                  setCollapsed({ ...collapsed, [run.groupId]: !collapsed[run.groupId] })
                }
              />
              {!collapsed[run.groupId] && run.tabs.map((tab) => row(tab, true))}
            </div>
          ) : (
            run.tabs.map((tab) => row(tab, false))
          ),
        )}
      </div>
    </section>
  );
}
