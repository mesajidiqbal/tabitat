/** Popup (UI-SPEC §Popup, 360 × 540): header, search, sections or results, banner, footer. */
import { t } from "@/i18n";
import { SearchBox } from "@/ui/components/SearchBox";
import { Toast } from "@/ui/components/Toast";
import { useSurface } from "@/ui/hooks/useSurface";
import { Logo } from "@/ui/icons";
import { ClosedSection } from "@/ui/sections/ClosedSection";
import { Header } from "@/ui/sections/Header";
import { LinksSection } from "@/ui/sections/LinksSection";
import { RecoveryBanner } from "@/ui/sections/RecoveryBanner";
import { RESULTS_ID, resultId, SearchResults } from "@/ui/sections/SearchResults";
import { TabsSection } from "@/ui/sections/TabsSection";
import { WindowActions } from "@/ui/sections/WindowActions";
import { WorkspacesSection } from "@/ui/sections/WorkspacesSection";
import { useStore } from "@/ui/store";
import s from "./popup.module.css";

export function App() {
  useStore();
  const ui = useSurface("popup");
  const searching = ui.query.trim() !== "";
  return (
    <div class={s.app}>
      <Header variant="popup" onSearch={ui.focusSearch} />
      <SearchBox
        value={ui.query}
        onInput={ui.setQuery}
        onKeyDown={ui.onSearchKeyDown}
        inputRef={ui.inputRef}
        listId={RESULTS_ID}
        activeId={ui.hits.length > 0 ? resultId(ui.selected) : undefined}
        autoFocus
      />
      <main class={s.main}>
        {searching ? (
          <SearchResults hits={ui.hits} selected={ui.selected} onSelect={ui.setSelected} />
        ) : (
          <>
            <WorkspacesSection variant="popup" onExitTop={ui.focusSearch} />
            <TabsSection variant="popup" />
            <LinksSection variant="popup" />
            <ClosedSection variant="popup" />
          </>
        )}
      </main>
      <RecoveryBanner />
      <footer class={s.footer}>
        <span class={s.brand} title={t("appDescription")}>
          <Logo />
          {t("appName")}
        </span>
        <WindowActions />
      </footer>
      <Toast />
    </div>
  );
}
