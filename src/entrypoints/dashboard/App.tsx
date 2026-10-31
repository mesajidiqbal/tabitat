/**
 * Dashboard (docs/PHASE4.md §4; also the new-tab page of the newtab flavor): Clock + Search top
 * row, the backup reminder banner, widget cards in settings.dashboard.widgets order, ⚙ Customize.
 * Widgets are code-split (lazy + Suspense with fixed-height skeletons); the wallpaper image is
 * loaded after first paint and reloaded whenever the setting's value (its `#<ts>` stamp) changes.
 * Over an image or colour wallpaper the top row sits on a scrim so its text keeps its contrast.
 */
import { effect } from "@preact/signals";
import type { ComponentType } from "preact";
import { lazy, Suspense } from "preact/compat";
import { useEffect, useRef, useState } from "preact/hooks";
import type { WidgetId } from "@/core/model/types";
import { t } from "@/i18n";
import { ErrorBanner } from "@/ui/components/ErrorBanner";
import { ProgressRow } from "@/ui/components/ProgressRow";
import { Toast } from "@/ui/components/Toast";
import { IconSettings } from "@/ui/icons";
import { BackupBanner } from "@/ui/sections/BackupBanner";
import { store, useStore } from "@/ui/store";
import { applyTheme } from "@/ui/theme";
import { Skeleton } from "@/ui/widgets/Card";
import { Clock } from "@/ui/widgets/Clock";
import { gridWidgets } from "@/ui/widgets/order";
import s from "./dashboard.module.css";
import { dashboard, dashSettings } from "./settings";
import {
  isImageValue,
  shouldDropImageBlob,
  type Wallpaper,
  wallpaperBackground,
} from "./wallpaper";

type W = ComponentType<{ compact?: boolean; docTitle?: boolean }>;

const SearchWidget = lazy(() => import("@/ui/widgets").then((m) => ({ default: m.SearchWidget })));
const Customize = lazy(() => import("./Customize").then((m) => ({ default: m.Customize })));
const CARDS: Record<Exclude<WidgetId, "clock" | "search">, W> = {
  quicklinks: lazy(() => import("@/ui/widgets").then((m) => ({ default: m.QuickLinksGrid }))),
  workspaces: lazy(() => import("@/ui/widgets").then((m) => ({ default: m.WorkspacesWidget }))),
  todos: lazy(() => import("@/ui/widgets").then((m) => ({ default: m.Todos }))),
  notes: lazy(() => import("@/ui/widgets").then((m) => ({ default: m.Notes }))),
  pomodoro: lazy(() => import("@/ui/widgets").then((m) => ({ default: m.Pomodoro }))),
};

effect(() => applyTheme(dashSettings.value.theme));

/**
 * The uploaded wallpaper (data: URL) for an image setting `value`, loaded after first paint. A new
 * value (another upload, here or on another page) loads again; a load that finishes after a
 * newer one started is dropped, so an older picture never replaces a newer one.
 */
function useWallpaperImage(value: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  const seq = useRef(0);
  useEffect(() => {
    const mine = ++seq.current;
    if (value === null) return setUrl(null);
    const id = setTimeout(
      () =>
        void import("./wallpaper-db")
          .then((m) => m.loadImageUrl(value))
          .then(
            (u) => mine === seq.current && setUrl(u),
            () => mine === seq.current && setUrl(null),
          ),
      0,
    );
    return () => clearTimeout(id);
  }, [value]);
  return url;
}

/** Deletes the stored image once the wallpaper is no longer one (here, elsewhere or synced). */
function useOrphanCleanup(ready: boolean, wp: Wallpaper): void {
  const drop = shouldDropImageBlob(ready, wp);
  useEffect(() => {
    if (!drop) return;
    const id = setTimeout(
      () => void import("./wallpaper-db").then((m) => m.deleteImage()).catch(() => undefined),
      1000,
    );
    return () => clearTimeout(id);
  }, [drop, wp.kind]);
}

export function App() {
  useStore();
  const dash = dashboard.value;
  const [customize, setCustomize] = useState(false);
  const gear = useRef<HTMLButtonElement>(null);
  const wp = dash.wallpaper;
  const image = useWallpaperImage(wp.kind === "image" && isImageValue(wp.value) ? wp.value : null);
  useOrphanCleanup(store.ready.value, wp);
  /** Image / colour wallpapers can be anything behind the text: the top row gets a scrim. */
  const scrim = wp.kind !== "gradient" ? s.scrim : "";
  const background = image ? `center / cover no-repeat url("${image}")` : wallpaperBackground(wp);
  const has = (w: WidgetId) => dash.widgets.includes(w);
  const close = () => {
    setCustomize(false);
    gear.current?.focus();
  };
  return (
    <div class={s.page} style={{ background }}>
      <div class={s.app}>
        <header class={s.bar}>
          <h1 class="sr-only">{t("appName")}</h1>
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
          <div class={`${s.top} ${scrim}`}>
            {has("clock") && <Clock />}
            {has("search") && (
              <Suspense fallback={<div class={s.searchSkeleton} />}>
                <SearchWidget />
              </Suspense>
            )}
          </div>
        )}
        <BackupBanner variant="page" />
        <ErrorBanner />
        <ProgressRow />
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
