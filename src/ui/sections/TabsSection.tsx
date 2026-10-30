/** TABS IN THIS WINDOW: live tabs grouped by tab group; activate / close / park. */
import { useState } from "preact/hooks";
import { t } from "@/i18n";
import { send } from "@/messaging/client";
import { activateTab, attempt } from "../actions";
import r from "../components/rows.module.css";
import { SectionHeader } from "../components/SectionHeader";
import { TabGroupHeader } from "../components/TabGroupHeader";
import { TabRow } from "../components/TabRow";
import { showToast } from "../components/Toast";
import { useRoving } from "../hooks/useRoving";
import { IconClose, IconPark } from "../icons";
import { activeWorkspaceId, busy, store } from "../store";
import { tabRuns, type UiTab } from "../tabs";
import { colorVar } from "../theme";
import s from "./sections.module.css";
import { WindowActions } from "./WindowActions";

export function TabsSection(p: { variant: "popup" | "panel" }) {
  const tabs = store.liveTabs.value;
  const ws = activeWorkspaceId.value;
  const [collapsed, setCollapsed] = useState<Record<number, boolean>>({});
  const runs = tabRuns(tabs, store.groups.value);
  const visible = runs.flatMap((run) => (run.group && collapsed[run.groupId] ? [] : run.tabs));
  const pos = new Map(visible.map((tab, i) => [tab.id, i]));
  const roving = useRoving(visible.length);
  const disabled = busy.value;
  const panel = p.variant === "panel";

  const row = (tab: UiTab, inGroup: boolean) => {
    const actions = [
      {
        label: t("closeTab"),
        icon: <IconClose size={14} />,
        run: () => void chrome.tabs.remove(tab.id),
        del: true,
      },
    ];
    if (ws && !tab.pinned) {
      actions.push({
        label: t("parkTab"),
        icon: <IconPark size={14} />,
        run: () =>
          void attempt(() => send("tabs.park", { tabId: tab.id, workspaceId: ws })).then(
            (link) => link && showToast({ message: t("parked", link.title || link.url) }),
          ),
        del: false,
      });
    }
    return (
      <TabRow
        key={tab.id}
        title={tab.title}
        url={tab.url}
        item={roving.item(pos.get(tab.id) ?? -1)}
        onOpen={() => void activateTab(tab.id, tab.windowId)}
        actions={actions}
        current={tab.active}
        pinned={tab.pinned}
        suspended={tab.placeholder || tab.discarded}
        showHost={panel}
        inGroup={inGroup}
        disabled={disabled}
      />
    );
  };

  return (
    <section class={s.section} aria-labelledby="tabs-h">
      <SectionHeader id="tabs-h" title={t("tabsInWindow")} count={tabs.length} sticky={panel} />
      {panel && (
        <div class={s.toolbar}>
          <WindowActions />
        </div>
      )}
      <div role="listbox" aria-labelledby="tabs-h" class={r.list}>
        {runs.map((run) =>
          run.group ? (
            // biome-ignore lint/a11y/useSemanticElements: ARIA group inside a listbox (no fieldset there)
            <div
              key={`g${run.groupId}`}
              role="group"
              aria-labelledby={`grp-${run.groupId}`}
              class={r.group}
              style={{ "--dot": colorVar(run.group.color) }}
            >
              <TabGroupHeader
                id={`grp-${run.groupId}`}
                group={run.group}
                count={run.tabs.length}
                collapsed={collapsed[run.groupId] === true}
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
