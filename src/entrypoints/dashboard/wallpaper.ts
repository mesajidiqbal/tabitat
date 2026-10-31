/**
 * Wallpaper presets and the device-local image (docs/PHASE4.md §0 exception): the image blob
 * lives in IndexedDB (`tabitat` / `blobs` / `wallpaper`), never synced or backed up; the setting
 * only says `{ kind: "image", value: "idb:wallpaper#<ts>" }` (the stamp changes on every
 * replace, so every open dashboard sees a settings change and reloads the picture; a bare
 * `idb:wallpaper` from earlier builds is still read). CSS values come from fixed tables or a
 * validated hex colour, and are applied through CSSOM (CSP-safe). The extension CSP has no
 * `blob:` in img-src, so the image is shown as a data: URL (wallpaper-db.ts, loaded on demand).
 */
import { DEFAULT_SETTINGS, type Settings } from "@/core/model/types";

export type Wallpaper = Settings["dashboard"]["wallpaper"];

export const IMAGE_VALUE = "idb:wallpaper";
const STAMP_RE = /^idb:wallpaper#(\d{1,16})$/;

/** Setting value for an image stored at `ts`. */
export const imageValue = (ts: number): string => `${IMAGE_VALUE}#${Math.trunc(ts)}`;
/** Any (short) value starting with `idb:wallpaper` names the stored image. */
export const isImageValue = (v: unknown): v is string =>
  typeof v === "string" && v.length <= 64 && v.startsWith(IMAGE_VALUE);
/** The `#<ts>` stamp of an image value ("" without a well-formed one). */
export const imageStamp = (v: string): string => STAMP_RE.exec(v)?.[1] ?? "";
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export const GRADIENTS: Readonly<Record<string, string>> = {
  aurora: "linear-gradient(135deg, #a8edea 0%, #c3b5f5 50%, #fed6e3 100%)",
  dusk: "linear-gradient(135deg, #2c3e50 0%, #4b6cb7 100%)",
  ocean: "linear-gradient(135deg, #1fa2ff 0%, #12d8fa 50%, #a6ffcb 100%)",
  forest: "linear-gradient(135deg, #134e5e 0%, #71b280 100%)",
  sunset: "linear-gradient(135deg, #ff9a8b 0%, #ff6a88 55%, #ff99ac 100%)",
  slate: "linear-gradient(135deg, #232526 0%, #414345 100%)",
  sand: "linear-gradient(135deg, #f6d365 0%, #fda085 100%)",
  mist: "linear-gradient(135deg, #e0eafc 0%, #cfdef3 100%)",
};
export const SWATCHES: readonly string[] = [
  "#f5f6f8",
  "#e8eef7",
  "#fdf2e3",
  "#e7f4ea",
  "#1b1d21",
  "#1e2a3a",
  "#2d2338",
  "#14302b",
];

const HEX = /^#[0-9a-f]{6}$/i;

/** A valid wallpaper setting (unknown preset / bad colour -> the default gradient). */
export function sanitizeWallpaper(raw: unknown): Wallpaper {
  const d = DEFAULT_SETTINGS.dashboard.wallpaper;
  if (typeof raw !== "object" || raw === null) return { ...d };
  const { kind, value } = raw as Record<string, unknown>;
  if (kind === "gradient" && typeof value === "string" && Object.hasOwn(GRADIENTS, value))
    return { kind, value };
  if (kind === "color" && typeof value === "string" && HEX.test(value)) return { kind, value };
  if (kind === "image" && isImageValue(value)) return { kind, value };
  return { ...d };
}

/** CSS `background` for a gradient / colour wallpaper (an image starts on the default). */
export function wallpaperBackground(wp: Wallpaper): string {
  if (wp.kind === "color" && HEX.test(wp.value)) return wp.value;
  const name = Object.hasOwn(GRADIENTS, wp.value)
    ? wp.value
    : DEFAULT_SETTINGS.dashboard.wallpaper.value;
  return GRADIENTS[name] ?? "";
}

/**
 * Orphan check (Gemini review): once settings are loaded, a wallpaper that is not an image means
 * the stored blob is unused (replaced on this page, from another page or by sync) and can go.
 */
export const shouldDropImageBlob = (ready: boolean, wp: Wallpaper): boolean =>
  ready && !(wp.kind === "image" && isImageValue(wp.value));
