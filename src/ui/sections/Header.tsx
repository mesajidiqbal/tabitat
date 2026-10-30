/** Header: active workspace (dot + name) with a ▾ menu, then surface-specific icon buttons. */
import { t } from "@/i18n";
import { newWorkspaceOpen, openExtPage, openSidePanel } from "../actions";
import { IconButton } from "../components/IconButton";
import { Menu } from "../components/Menu";
import { IconChevronDown, IconGrid, IconSearch, IconSettings, IconSidePanel } from "../icons";
import { activeMeta } from "../store";
import { colorVar } from "../theme";
import s from "./sections.module.css";

export function Header(p: { variant: "popup" | "panel"; onSearch: () => void }) {
  const meta = activeMeta.value;
  const name = !meta ? t("noWorkspace") : meta.kind === "unsorted" ? t("unsorted") : meta.name;
  const popup = p.variant === "popup";
  return (
    <header class={s.header}>
      <Menu
        label={t("currentWorkspaceMenu", name)}
        trigger={
          <>
            <span class={s.headerDot} style={{ "--dot": colorVar(meta?.color) }} />
            <span class={s.headerName} data-testid="active-workspace">
              {name}
            </span>
            <IconChevronDown size={12} />
          </>
        }
        items={[
          { label: t("newWorkspace"), onSelect: () => (newWorkspaceOpen.value = true) },
          { label: t("openDashboard"), onSelect: () => openExtPage("/dashboard.html") },
          { label: t("recoveryAndBackup"), onSelect: () => openExtPage("/recovery.html") },
        ]}
      />
      <span class={s.spacer} />
      {popup && (
        <IconButton
          label={t("focusSearch")}
          icon={<IconSearch />}
          keyshortcuts="/"
          onClick={p.onSearch}
        />
      )}
      {popup ? (
        <IconButton
          label={t("openSidePanel")}
          icon={<IconSidePanel />}
          keyshortcuts="s"
          onClick={openSidePanel}
        />
      ) : (
        <IconButton
          label={t("openDashboard")}
          icon={<IconGrid />}
          onClick={() => openExtPage("/dashboard.html")}
        />
      )}
      <IconButton
        label={t("openSettings")}
        icon={<IconSettings />}
        onClick={() => void chrome.runtime.openOptionsPage()}
      />
    </header>
  );
}
