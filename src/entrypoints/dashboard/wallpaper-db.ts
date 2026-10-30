/** IndexedDB access for the wallpaper image (split out so first paint does not load `idb`). */
import { openDB } from "idb";

const STORE = "blobs";
const KEY = "wallpaper";
const db = () =>
  openDB("tabitat", 1, {
    upgrade(d) {
      if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE);
    },
  });

export async function saveImage(blob: Blob): Promise<void> {
  await (await db()).put(STORE, blob, KEY);
}
export async function deleteImage(): Promise<void> {
  await (await db()).delete(STORE, KEY);
}

/** The stored image as a data: URL; null when there is none (e.g. a synced setting). */
export async function loadImageUrl(): Promise<string | null> {
  const blob: unknown = await (await db()).get(STORE, KEY);
  if (!(blob instanceof Blob)) return null;
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(typeof r.result === "string" ? r.result : null);
    r.onerror = () => resolve(null);
    r.readAsDataURL(blob);
  });
}
