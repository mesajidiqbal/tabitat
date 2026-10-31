/**
 * The search engine (fuzzysort + the incremental index in search.ts) loaded off the first paint
 * of the popup and side panel (review C-S1, popup budget): `preloadSearch()` asks for it right
 * after the first frame, and the first query asks too. Until it is in, `searchHits()` has no
 * hits and `searchReady()` is false (results show nothing rather than "No results"); an Enter
 * pressed in that window opens the first hit once the module has loaded.
 */
import { signal } from "@preact/signals";
import type { UiHit } from "./search";

type SearchModule = typeof import("./search");

const mod = signal<SearchModule | null>(null);
let loading: Promise<SearchModule> | null = null;

export function loadSearch(): Promise<SearchModule> {
  loading ??= import("./search").then((m) => {
    mod.value = m;
    return m;
  });
  return loading;
}

/** Starts loading after the first frame (idle time when available). */
export function preloadSearch(): void {
  const start = () => void loadSearch().catch(() => undefined);
  if (typeof requestIdleCallback === "function") requestIdleCallback(start, { timeout: 300 });
  else setTimeout(start, 50);
}

/** The engine is loaded (reading it subscribes the calling component). */
export const searchReady = (): boolean => mod.value !== null;

/** `search(query, limit)` once loaded; no hits (and a load request) before. */
export function searchHits(query: string, limit?: number): UiHit[] {
  const m = mod.value;
  if (m) return m.search(query, limit);
  if (query.trim() !== "") void loadSearch().catch(() => undefined);
  return [];
}

export const openHit = (hit: UiHit): Promise<void> => loadSearch().then((m) => m.openHit(hit));

/** Opens the first hit for `query` (Enter before the engine had loaded). */
export async function openFirstHit(query: string): Promise<void> {
  const m = await loadSearch();
  const hit = m.search(query, 1)[0];
  if (hit) await m.openHit(hit);
}
