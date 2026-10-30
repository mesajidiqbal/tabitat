/** Side panel: same read model and sections as the popup, full height, sticky headers, cards. */
import { t } from "@/i18n";
import { openExtPage } from "@/ui/actions";
import c from "@/ui/components/controls.module.css";
import { ErrorBanner } from "@/ui/components/ErrorBanner";
import { ProgressRow } from "@/ui/components/ProgressRow";
import { SearchBox } from "@/ui/components/SearchBox";
import { Toast } from "@/ui/components/Toast";
import { useSurface } from "@/ui/hooks/useSurface";
import { ClosedSection } from "@/ui/sections/ClosedSection";
import { Header } from "@/ui/sections/Header";
import { LinksSection } from "@/ui/sections/LinksSection";
import { RecoveryBanner } from "@/ui/sections/RecoveryBanner";
import { RESULTS_ID, resultId, SearchResults } from "@/ui/sections/SearchResults";
import { TabsSection } from "@/ui/sections/TabsSection";
import { WorkspacesSection } from "@/ui/sections/WorkspacesSection";
import { useStore } from "@/ui/store";
import s from "./sidepanel.module.css";

export function App() {
  useStore();
  const ui = useSurface("panel");
  const searching = ui.query.trim() !== "";
  return (
    <div class={s.app}>
      <div class={s.top}>
        <Header variant="panel" onSearch={ui.focusSearch} />
        <SearchBox
          value={ui.query}
          onInput={ui.setQuery}
          onKeyDown={ui.onSearchKeyDown}
          inputRef={ui.inputRef}
          listId={RESULTS_ID}
          activeId={ui.hits.length > 0 ? resultId(ui.selected) : undefined}
        />
        <ErrorBanner />
        <ProgressRow />
      </div>
      <main class={s.main}>
        {searching ? (
          <SearchResults hits={ui.hits} selected={ui.selected} onSelect={ui.setSelected} />
        ) : (
          <>
            <WorkspacesSection variant="panel" onExitTop={ui.focusSearch} />
            <TabsSection variant="panel" />
            <LinksSection variant="panel" />
            <ClosedSection variant="panel" />
          </>
        )}
      </main>
      <RecoveryBanner />
      <div class={s.foot}>
        <button type="button" class={c.link} onClick={() => openExtPage("/dashboard.html")}>
          {t("dashboardLink")}
        </button>
      </div>
      <Toast />
    </div>
  );
}
