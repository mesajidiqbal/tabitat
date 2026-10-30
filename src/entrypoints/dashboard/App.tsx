/**
 * Dashboard (docs/PHASE4.md §4; also the new-tab page of the newtab flavor): Clock + Search top
 * row, widget cards in settings.dashboard.widgets order, ⚙ Customize. Widgets are code-split
 * (lazy + Suspense with fixed-height skeletons); the wallpaper image is loaded after first paint.
 */
import { effect } from "@preact/signals";
import type { ComponentType } from "preact";
import { lazy, Suspense } from "preact/compat";
import { useEffect, useRef, useState } from "preact/hooks";
import type { WidgetId } from "@/core/model/types";
import { t } from "@/i18n";
import { Toast } from "@/ui/components/Toast";
import { IconSettings } from "@/ui/icons";
import { useStore } from "@/ui/store";
import { applyTheme } from "@/ui/theme";
import { Skeleton } from "@/ui/widgets/Card";
import { Clock } from "@/ui/widgets/Clock";
import { gridWidgets } from "@/ui/widgets/order";
import s from "./dashboard.module.css";
import { dashboard, dashSettings } from "./settings";
import { wallpaperBackground } from "./wallpaper";

type W = ComponentType<{ compact?: boolean; docTitle?: boolean }>;

const SearchWidget = lazy(() => import("@/ui/widgets").then((m) => ({ default: m.SearchWidget })));
/** Error line and switch progress: only after an action, so in the widgets chunk (not first paint). */
const ErrorBanner = lazy(() => import("@/ui/widgets").then((m) => ({ default: m.ErrorBanner })));
const ProgressRow = lazy(() => import("@/ui/widgets").then((m) => ({ default: m.ProgressRow })));
const Customize = lazy(() => import("./Customize").then((m) => ({ default: m.Customize })));
const CARDS: Record<Exclude<WidgetId, "clock" | "search">, W> = {
  quicklinks: lazy(() => import("@/ui/widgets").then((m) => ({ default: m.QuickLinksGrid }))),
  workspaces: lazy(() => import("@/ui/widgets").then((m) => ({ default: m.WorkspacesWidget }))),
  todos: lazy(() => import("@/ui/widgets").then((m) => ({ default: m.Todos }))),
  notes: lazy(() => import("@/ui/widgets").then((m) => ({ default: m.Notes }))),
  pomodoro: lazy(() => import("@/ui/widgets").then((m) => ({ default: m.Pomodoro }))),
};

effect(() => applyTheme(dashSettings.value.theme));

/** The uploaded wallpaper (data: URL) when the setting is "image"; loaded after first paint. */
function useWallpaperImage(isImage: boolean): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!isImage) return setUrl(null);
    let alive = true;
    const load = () =>
      void import("./wallpaper-db")
        .then((m) => m.loadImageUrl())
        .then(
          (u) => alive && setUrl(u),
          () => alive && setUrl(null),
        );
    const id = setTimeout(load, 0);
    addEventListener("tabitat:wallpaper", load);
    return () => {
      alive = false;
      clearTimeout(id);
      removeEventListener("tabitat:wallpaper", load);
    };
  }, [isImage]);
  return url;
}

export function App() {
  useStore();
  const dash = dashboard.value;
  const [customize, setCustomize] = useState(false);
  const gear = useRef<HTMLButtonElement>(null);
  const image = useWallpaperImage(dash.wallpaper.kind === "image");
  const background = image
    ? `center / cover no-repeat url("${image}")`
    : wallpaperBackground(dash.wallpaper);
  const has = (w: WidgetId) => dash.widgets.includes(w);
  const close = () => {
    setCustomize(false);
    gear.current?.focus();
  };
  return (
    <div class={s.page} style={{ background }}>
      <div class={s.app}>
        <header class={s.bar}>
          <button
            ref={gear}
            type="button"
            class={s.gear}
            aria-expanded={customize}
            onClick={() => (customize ? close() : setCustomize(true))}
          >
            <IconSettings />
            {t("dashCustomize")}
          </button>
        </header>
        {(has("clock") || has("search")) && (
          <div class={s.top}>
            {has("clock") && <Clock />}
            {has("search") && (
              <Suspense fallback={<div class={s.searchSkeleton} />}>
                <SearchWidget />
              </Suspense>
            )}
          </div>
        )}
        <Suspense fallback={null}>
          <ErrorBanner />
          <ProgressRow />
        </Suspense>
        <main class={s.grid}>
          {gridWidgets(dash.widgets).map((id) => {
            const Card = CARDS[id as keyof typeof CARDS];
            return (
              <Suspense key={id} fallback={<Skeleton />}>
                <Card docTitle />
              </Suspense>
            );
          })}
          {gridWidgets(dash.widgets).length === 0 && <p class={s.empty}>{t("dashNoWidgets")}</p>}
        </main>
      </div>
      {customize && (
        <Suspense fallback={null}>
          <Customize onClose={close} />
        </Suspense>
      )}
      <Toast />
    </div>
  );
}
