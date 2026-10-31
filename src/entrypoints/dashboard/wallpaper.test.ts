import { describe, expect, it } from "vitest";
import {
  imageStamp,
  imageValue,
  isImageValue,
  sanitizeWallpaper,
  shouldDropImageBlob,
} from "./wallpaper";
import {
  type BlobStore,
  findImage,
  IMAGE_KEY,
  removeImage,
  replaceImage,
  TEMP_KEY,
} from "./wallpaper-db";

const DEFAULT = { kind: "gradient", value: "aurora" };

describe("wallpaper setting values", () => {
  it("sanitizeWallpaper keeps image values with and without the #stamp", () => {
    expect(sanitizeWallpaper({ kind: "image", value: "idb:wallpaper" })).toEqual({
      kind: "image",
      value: "idb:wallpaper",
    });
    expect(sanitizeWallpaper({ kind: "image", value: "idb:wallpaper#1761900000000" })).toEqual({
      kind: "image",
      value: "idb:wallpaper#1761900000000",
    });
    for (const value of ["idb:other", "https://x.test/a.png", 3, `idb:wallpaper#${"9".repeat(80)}`])
      expect(sanitizeWallpaper({ kind: "image", value })).toEqual(DEFAULT);
    expect(sanitizeWallpaper({ kind: "color", value: "#12ab34" })).toEqual({
      kind: "color",
      value: "#12ab34",
    });
  });

  it("imageValue / imageStamp / isImageValue round-trip", () => {
    const v = imageValue(1761900000000.7);
    expect(v).toBe("idb:wallpaper#1761900000000");
    expect(isImageValue(v)).toBe(true);
    expect(imageStamp(v)).toBe("1761900000000");
    expect(imageStamp("idb:wallpaper")).toBe("");
    expect(imageStamp("idb:wallpaper#x")).toBe("");
  });

  it("shouldDropImageBlob: only once settings are loaded and the wallpaper is not an image", () => {
    expect(shouldDropImageBlob(true, { kind: "gradient", value: "dusk" })).toBe(true);
    expect(shouldDropImageBlob(true, { kind: "color", value: "#000000" })).toBe(true);
    expect(shouldDropImageBlob(true, { kind: "image", value: "idb:wallpaper#5" })).toBe(false);
    // Before the store is ready the default gradient says nothing about the user's setting.
    expect(shouldDropImageBlob(false, { kind: "gradient", value: "aurora" })).toBe(false);
  });
});

/** In-memory BlobStore; `failPut` makes puts of that key throw. */
function fakeStore(init: Record<string, unknown> = {}, failPut?: string) {
  const data = new Map<string, unknown>(Object.entries(init));
  const store: BlobStore = {
    get: async (k) => data.get(k),
    put: async (k, v) => {
      if (k === failPut) throw new Error("QuotaExceededError");
      data.set(k, v);
    },
    delete: async (k) => {
      data.delete(k);
    },
  };
  return { store, data };
}

const blob = (text: string) => new Blob([text], { type: "image/png" });

describe("replaceImage (temp → settings → promote)", () => {
  it("promotes the temp record after the setting is written and drops the temp", async () => {
    const old = { ts: "1", blob: blob("old") };
    const { store, data } = fakeStore({ [IMAGE_KEY]: old });
    const seen: unknown[] = [];
    const ok = await replaceImage(
      blob("new"),
      "2",
      async () => {
        // While the setting is written the old image is untouched and the new one is the temp.
        seen.push(data.get(IMAGE_KEY), (data.get(TEMP_KEY) as { ts: string }).ts);
        return true;
      },
      store,
    );
    expect(ok).toBe(true);
    expect(seen).toEqual([old, "2"]);
    expect((data.get(IMAGE_KEY) as { ts: string }).ts).toBe("2");
    expect(data.has(TEMP_KEY)).toBe(false);
  });

  it("rolls back when the settings write fails or throws: old image kept, temp dropped", async () => {
    for (const commit of [async () => false, async () => Promise.reject(new Error("x"))]) {
      const old = { ts: "1", blob: blob("old") };
      const { store, data } = fakeStore({ [IMAGE_KEY]: old });
      expect(await replaceImage(blob("new"), "2", commit, store)).toBe(false);
      expect(data.get(IMAGE_KEY)).toBe(old);
      expect(data.has(TEMP_KEY)).toBe(false);
    }
  });

  it("throws before touching the setting when the blob cannot be stored", async () => {
    const { store } = fakeStore({}, TEMP_KEY);
    let committed = false;
    await expect(
      replaceImage(
        blob("new"),
        "2",
        async () => {
          committed = true;
          return true;
        },
        store,
      ),
    ).rejects.toThrow("Quota");
    expect(committed).toBe(false);
  });

  it("a failed promote leaves the temp, which readers find by its stamp", async () => {
    const { store, data } = fakeStore({ [IMAGE_KEY]: { ts: "1", blob: blob("old") } }, IMAGE_KEY);
    expect(await replaceImage(blob("new"), "2", async () => true, store)).toBe(true);
    expect(data.has(TEMP_KEY)).toBe(true);
    expect(await (await findImage("idb:wallpaper#2", store))?.text()).toBe("new");
    expect(await (await findImage("idb:wallpaper#1", store))?.text()).toBe("old");
  });
});

describe("removeImage (settings first, then the blob)", () => {
  it("keeps the blob when the settings write fails", async () => {
    const { store, data } = fakeStore({ [IMAGE_KEY]: { ts: "1", blob: blob("a") } });
    expect(await removeImage(async () => false, store)).toBe("settings");
    expect(data.has(IMAGE_KEY)).toBe(true);
  });

  it("deletes image and temp after the setting changed", async () => {
    const { store, data } = fakeStore({ [IMAGE_KEY]: blob("a"), [TEMP_KEY]: blob("b") });
    expect(await removeImage(async () => true, store)).toBe("ok");
    expect(data.size).toBe(0);
  });

  it("reads a bare Blob stored by an earlier build", async () => {
    const { store } = fakeStore({ [IMAGE_KEY]: blob("legacy") });
    expect(await (await findImage("idb:wallpaper", store))?.text()).toBe("legacy");
    expect(await findImage("idb:wallpaper", fakeStore().store)).toBeNull();
  });
});
