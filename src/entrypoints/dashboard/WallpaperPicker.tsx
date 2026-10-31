/**
 * Wallpaper choices: 8 gradient presets, 8 colour swatches, "Upload image…" (≤ 5 MB, decoded
 * first, stored in IndexedDB; the setting only names it) and "Remove image". Every setting write
 * goes through settings.update (dashboardPatch) and is checked: a failed write leaves the
 * previous image in place (wallpaper-db.ts). Other dashboards reload the picture from the
 * setting's new `#<ts>` stamp.
 */
import { useState } from "preact/hooks";
import { DEFAULT_SETTINGS } from "@/core/model/types";
import { t } from "@/i18n";
import c from "@/ui/components/controls.module.css";
import s from "./dashboard.module.css";
import { dashboard, dashboardPatch, updateSettings } from "./settings";
import { GRADIENTS, imageValue, MAX_IMAGE_BYTES, SWATCHES, type Wallpaper } from "./wallpaper";
import { removeImage, replaceImage } from "./wallpaper-db";

const set = (wallpaper: Wallpaper) => updateSettings((cur) => dashboardPatch(cur, { wallpaper }));

/** The file decodes as an image (MIME and size alone accept corrupt data; review C-U4). */
async function decodes(file: Blob): Promise<boolean> {
  try {
    const bitmap = await createImageBitmap(file);
    bitmap.close();
    return true;
  } catch {
    return false;
  }
}

export function WallpaperPicker() {
  const wp = dashboard.value.wallpaper;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const chosen = (kind: Wallpaper["kind"], value: string) => wp.kind === kind && wp.value === value;

  const upload = async (file: File | undefined) => {
    setError(null);
    if (!file) return;
    if (!file.type.startsWith("image/")) return setError(t("dashWallpaperNotImage"));
    if (file.size > MAX_IMAGE_BYTES) return setError(t("dashWallpaperTooLarge", 5));
    setBusy(true);
    try {
      if (!(await decodes(file))) return setError(t("dashWallpaperUndecodable"));
      const ts = Date.now();
      const ok = await replaceImage(file, String(ts), () =>
        set({ kind: "image", value: imageValue(ts) }),
      );
      if (!ok) setError(t("dashWallpaperSaveFailed"));
    } catch {
      setError(t("dashWallpaperSaveFailed"));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setError(null);
    setBusy(true);
    const out = await removeImage(() => set({ ...DEFAULT_SETTINGS.dashboard.wallpaper }));
    if (out === "settings") setError(t("dashWallpaperSaveFailed"));
    else if (out === "blob") setError(t("dashWallpaperRemoveFailed"));
    setBusy(false);
  };

  return (
    <fieldset class={s.fieldset}>
      <legend>{t("dashWallpaper")}</legend>
      {/* biome-ignore lint/a11y/useSemanticElements: a swatch row inside the fieldset */}
      <div class={s.swatches} role="group" aria-label={t("dashWallpaperGradients")}>
        {Object.entries(GRADIENTS).map(([name, css], i) => (
          <button
            key={name}
            type="button"
            class={s.swatch}
            style={{ background: css }}
            aria-label={t("dashWallpaperGradient", i + 1)}
            title={t("dashWallpaperGradient", i + 1)}
            aria-pressed={chosen("gradient", name)}
            onClick={() => void set({ kind: "gradient", value: name })}
          />
        ))}
      </div>
      {/* biome-ignore lint/a11y/useSemanticElements: a swatch row inside the fieldset */}
      <div class={s.swatches} role="group" aria-label={t("dashWallpaperColors")}>
        {SWATCHES.map((hex, i) => (
          <button
            key={hex}
            type="button"
            class={s.swatch}
            style={{ background: hex }}
            aria-label={t("dashWallpaperColor", i + 1)}
            title={t("dashWallpaperColor", i + 1)}
            aria-pressed={chosen("color", hex)}
            onClick={() => void set({ kind: "color", value: hex })}
          />
        ))}
      </div>
      <div class={s.inline}>
        <label class={`${c.btn} ${s.fileBtn}`} aria-disabled={busy}>
          {t("dashWallpaperUpload")}
          <input
            type="file"
            accept="image/*"
            class="sr-only"
            disabled={busy}
            onChange={(e) => {
              void upload(e.currentTarget.files?.[0]);
              e.currentTarget.value = "";
            }}
          />
        </label>
        {wp.kind === "image" && (
          <button type="button" class={c.btn} disabled={busy} onClick={() => void remove()}>
            {t("dashWallpaperRemove")}
          </button>
        )}
      </div>
      {error && (
        <p class={s.err} role="alert">
          {error}
        </p>
      )}
    </fieldset>
  );
}
