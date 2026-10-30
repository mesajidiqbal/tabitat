/**
 * Options page (docs/PHASE3.md §5): one section at a time, chosen by the URL hash
 * (`options.html#suspension`). Settings are read from storage and written through the worker.
 */
import { Suspense } from "preact/compat";
import { useEffect, useState } from "preact/hooks";
import { t } from "@/i18n";
import { ErrorBoundary } from "@/ui/components/ErrorBoundary";
import { Logo } from "@/ui/icons";
import { Banners } from "@/ui/options/Banners";
import { SettingsProvider, useSettingsApi } from "@/ui/options/SettingsContext";
import { SECTIONS, sectionFromHash } from "@/ui/options/sections";
import { applyTheme } from "@/ui/theme";
import s from "./options.module.css";

function useHash(): string {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const on = () => setHash(location.hash);
    window.addEventListener("hashchange", on);
    on(); // a change between the first render and this (deferred) effect
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return hash;
}

function Shell() {
  const { settings, epoch } = useSettingsApi();
  const current = sectionFromHash(useHash());
  useEffect(() => applyTheme(settings.theme), [settings.theme]);
  const { Component } = current;
  return (
    <div class={s.page}>
      <header class={s.top}>
        <Logo size={24} />
        <h1>{t("optTitle")}</h1>
      </header>
      <div class={s.layout}>
        <nav class={s.nav} aria-label={t("optNavLabel")}>
          <ul>
            {SECTIONS.map((sec) => (
              <li key={sec.id}>
                <a
                  href={`#${sec.id}`}
                  class={s.navLink}
                  aria-current={sec.id === current.id ? "page" : undefined}
                >
                  {t(sec.label)}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <main class={s.content}>
          <Banners />
          <ErrorBoundary key={current.id} name={t(current.label)}>
            <Suspense
              fallback={
                <div
                  class={s.skeleton}
                  role="status"
                  aria-busy="true"
                  aria-label={t("optLoading")}
                />
              }
            >
              <Component key={epoch} />
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}

export function App() {
  return (
    <SettingsProvider>
      <Shell />
    </SettingsProvider>
  );
}
