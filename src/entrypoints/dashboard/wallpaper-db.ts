/**
 * IndexedDB access for the wallpaper image (split out so first paint does not load `idb`).
 * Records are `{ ts, blob }` (a bare Blob from earlier builds is still read). Replacing goes
 * through a temp key so a failed settings write never touches the current image:
 * temp `wallpaper:next` → settings.update (checked) → promote to `wallpaper` → drop the temp.
 * Removing writes the setting first and deletes the blob after.
 */
import { openDB } from "idb";
import { imageStamp } from "./wallpaper";

const STORE = "blobs";
export const IMAGE_KEY = "wallpaper";
export const TEMP_KEY = "wallpaper:next";

/** The few IndexedDB operations used here (a fake in unit tests). */
export interface BlobStore {
  get(key: string): Promise<unknown>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

interface Stored {
  ts: string;
  blob: Blob;
}
const isStored = (x: unknown): x is Stored =>
  typeof x === "object" &&
  x !== null &&
  typeof (x as Stored).ts === "string" &&
  (x as Stored).blob instanceof Blob;

const db = () =>
  openDB("tabitat", 1, {
    upgrade(d) {
      if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE);
    },
  });

export const idbStore: BlobStore = {
  get: async (key) => (await db()).get(STORE, key),
  put: async (key, value) => {
    await (await db()).put(STORE, value, key);
  },
  delete: async (key) => (await db()).delete(STORE, key),
};

/**
 * Stores `blob` as the new image. `commit` writes the setting (`idb:wallpaper#<ts>`) and says
 * whether it succeeded; on false (or a throw) the temp is dropped and the old image stays.
 * Throws when the blob cannot be stored at all (quota): nothing has changed then.
 */
export async function replaceImage(
  blob: Blob,
  ts: string,
  commit: () => Promise<boolean>,
  store: BlobStore = idbStore,
): Promise<boolean> {
  await store.put(TEMP_KEY, { ts, blob });
  const ok = await commit().catch(() => false);
  if (!ok) {
    await store.delete(TEMP_KEY).catch(() => undefined);
    return false;
  }
  try {
    await store.put(IMAGE_KEY, { ts, blob });
    await store.delete(TEMP_KEY);
  } catch {
    // The temp record still matches the setting's stamp: readers find it there.
  }
  return true;
}

/** "settings": the write failed (blob kept); "blob": setting changed, delete failed; "ok". */
export async function removeImage(
  commit: () => Promise<boolean>,
  store: BlobStore = idbStore,
): Promise<"ok" | "settings" | "blob"> {
  if (!(await commit().catch(() => false))) return "settings";
  try {
    await store.delete(IMAGE_KEY);
    await store.delete(TEMP_KEY);
    return "ok";
  } catch {
    return "blob";
  }
}

/** Drops the stored image (orphan cleanup; the temp of an upload in flight is left alone). */
export async function deleteImage(store: BlobStore = idbStore): Promise<void> {
  await store.delete(IMAGE_KEY);
}

/** The blob the setting `value` names: the temp record when its stamp matches, else the image. */
export async function findImage(value: string, store: BlobStore = idbStore): Promise<Blob | null> {
  const ts = imageStamp(value);
  if (ts) {
    const next = await store.get(TEMP_KEY);
    if (isStored(next) && next.ts === ts) return next.blob;
  }
  const main = await store.get(IMAGE_KEY);
  if (main instanceof Blob) return main;
  return isStored(main) ? main.blob : null;
}

/** The stored image as a data: URL; null when there is none (e.g. a synced setting). */
export async function loadImageUrl(value: string): Promise<string | null> {
  const blob = await findImage(value);
  if (!blob) return null;
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(typeof r.result === "string" ? r.result : null);
    r.onerror = () => resolve(null);
    r.readAsDataURL(blob);
  });
}
