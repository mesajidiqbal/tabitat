/**
 * Dashboard settings writes (docs/PHASE4.md §4 Customize): `settings.update` with `expectedRev`,
 * one at a time in call order, each patch computed from the latest known settings when it runs
 * (so quick successive toggles never undo each other). A `conflict` drops the queued patches,
 * re-reads storage and shows a notice, like the options page.
 */
import { computed, signal } from "@preact/signals";
import { DEFAULT_SETTINGS, Keys, type Settings } from "@/core/model/types";
import { t } from "@/i18n";
import { send } from "@/messaging/client";
import type { CommandIn } from "@/messaging/commands";
import { RpcError } from "@/messaging/errors";
import { errorInfo, uiError } from "@/ui/actions";
import { store } from "@/ui/store";
import { enabledWidgets } from "@/ui/widgets/order";
import { sanitizeWallpaper, type Wallpaper } from "./wallpaper";

type Patch = CommandIn<"settings.update">["patch"];

const isObj = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);

/** Our last acknowledged write (or a conflict re-read), shown until the store catches up. */
const known = signal<Settings | null>(null);
export const settingsNotice = signal<string | null>(null);

export const dashSettings = computed<Settings>(() => {
  const s = store.settings.value;
  const k = known.value;
  return k && k.rev > s.rev ? k : s;
});

export interface DashboardView {
  widgets: Settings["dashboard"]["widgets"];
  wallpaper: Wallpaper;
}

/** The dashboard part of settings, validated (older / synced records may lack or break it). */
export function dashboardOf(s: Settings): DashboardView {
  const d = isObj(s.dashboard) ? s.dashboard : DEFAULT_SETTINGS.dashboard;
  return {
    widgets: Array.isArray(d.widgets)
      ? enabledWidgets(d.widgets)
      : [...DEFAULT_SETTINGS.dashboard.widgets],
    wallpaper: sanitizeWallpaper(d.wallpaper),
  };
}
export const dashboard = computed(() => dashboardOf(dashSettings.value));

let queue: Promise<unknown> = Promise.resolve();
let generation = 0;

async function reload(): Promise<void> {
  generation++;
  try {
    const raw = (await chrome.storage.local.get(Keys.settings))[Keys.settings];
    if (isObj(raw)) known.value = raw as unknown as Settings;
  } catch {
    // the storage listener still delivers the current record
  }
  settingsNotice.value = t("dashSettingsConflict");
}

/** Queues a write; `make` builds the patch from the settings current when it runs (null: skip). */
export function updateSettings(make: (cur: Settings) => Patch | null): Promise<boolean> {
  const gen = generation;
  const run = async (): Promise<boolean> => {
    if (gen !== generation) return false;
    const cur = dashSettings.peek();
    const patch = make(cur);
    if (!patch) return true;
    try {
      known.value = await send("settings.update", { patch, expectedRev: cur.rev });
      settingsNotice.value = null;
      return true;
    } catch (e) {
      if (e instanceof RpcError && e.code === "conflict") await reload();
      else uiError.value = errorInfo(e);
      return false;
    }
  };
  const next = queue.then(run, run);
  queue = next;
  return next;
}

/** Patch helper: the whole dashboard object with `change` applied. */
export const dashboardPatch = (cur: Settings, change: Partial<DashboardView>): Patch => ({
  dashboard: { ...dashboardOf(cur), ...change },
});
