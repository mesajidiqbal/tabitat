/** Recovery page (UI-SPEC §Recovery): interrupted switch, sessions, quarantine, trash, import. */
import { t } from "@/i18n";
import { ErrorBoundary } from "@/ui/components/ErrorBoundary";
import { Toast } from "@/ui/components/Toast";
import { Logo } from "@/ui/icons";
import { useStore } from "@/ui/store";
import { Data } from "./Data";
import { ImportSection } from "./ImportSection";
import { Interrupted } from "./Interrupted";
import { Quarantine } from "./Quarantine";
import s from "./recovery.module.css";
import { Sessions } from "./Sessions";
import { TrashSection } from "./TrashSection";

export function App() {
  useStore();
  return (
    <main class={s.page}>
      <div class={s.top}>
        <Logo size={24} />
        <div>
          <h1>{t("recoveryTitle")}</h1>
          <p class={s.lead}>{t("recoveryLead")}</p>
        </div>
      </div>
      <ErrorBoundary name={t("interruptedTitle")}>
        <Interrupted />
      </ErrorBoundary>
      <ErrorBoundary name={t("sessionsTitle")}>
        <Sessions />
      </ErrorBoundary>
      <ErrorBoundary name={t("quarantineTitle")}>
        <Quarantine />
      </ErrorBoundary>
      <ErrorBoundary name={t("trashTitle")}>
        <TrashSection />
      </ErrorBoundary>
      <ErrorBoundary name={t("recoveryDataTitle")}>
        <Data />
      </ErrorBoundary>
      <ErrorBoundary name={t("importTitle")}>
        <ImportSection />
      </ErrorBoundary>
      <Toast />
    </main>
  );
}
