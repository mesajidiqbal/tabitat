import { describe, expect, it } from "vitest";
import { detectDirectSchemes } from "./brand";
import { isNoTabError } from "./errors";
import { FakeBrowser } from "./fake";

describe("FakeBrowser fidelity", () => {
  it("tabs.remove([valid, stale]) removes the valid one, then rejects (spike S7)", async () => {
    const fake = new FakeBrowser();
    const w = fake.addWindow(["https://a.example/", "https://b.example/"]);
    const [a] = fake.tabsOf(w).map((t) => t.id) as [number];
    const err = await fake
      .ports()
      .tabs.remove([a, 424242])
      .catch((e: unknown) => e);
    expect(isNoTabError(err)).toBe(true);
    expect(fake.hasTab(a)).toBe(false);
  });

  it("discard replaces the tab id and fires onReplaced (spike S11)", async () => {
    const fake = new FakeBrowser();
    const w = fake.addWindow(["https://a.example/", "https://b.example/"]);
    const ports = fake.ports();
    const seen: Array<[number, number]> = [];
    ports.events.onTabReplaced((a, r) => seen.push([a, r]));
    const old = fake.tabsOf(w)[1]?.id as number;
    await ports.tabs.discard(old);
    const now = fake.tabsOf(w)[1];
    expect(now?.id).not.toBe(old);
    expect(now?.discarded).toBe(true);
    expect(seen).toEqual([[now?.id, old]]);
    expect(await ports.tabs.get(old)).toBeNull();
  });

  it("failNext injects failures (count and predicate)", async () => {
    const fake = new FakeBrowser();
    const ports = fake.ports();
    fake.failNext("storage.set", 2);
    await expect(ports.local.set({ a: 1 })).rejects.toThrow(/injected/);
    await expect(ports.local.set({ a: 1 })).rejects.toThrow(/injected/);
    await ports.local.set({ a: 1 });
    fake.failNext("storage.set", { when: (items) => "b" in (items as object) });
    await ports.local.set({ a: 2 });
    await expect(ports.local.set({ b: 1 })).rejects.toThrow();
    fake.failNext("tabs.query");
    fake.clearFailures();
    await ports.tabs.query({});
  });

  it("killWorker: old ports hang, storage persists, new ports work", async () => {
    const fake = new FakeBrowser();
    const old = fake.ports();
    await old.local.set({ k: 1 });
    await old.session.set({ s: 1 });
    fake.killWorker();
    let settled = false;
    void old.local.get("k").then(() => {
      settled = true;
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(settled).toBe(false);
    const fresh = fake.ports();
    expect(await fresh.local.get("k")).toBe(1);
    expect(await fresh.session.get("s")).toBe(1);
    fake.restartBrowser();
    expect(await fake.ports().session.get("s")).toBeUndefined();
  });

  it("closing the last tab closes the window; create clamps after pinned tabs", async () => {
    const fake = new FakeBrowser();
    const w = fake.addWindow([{ url: "https://p.example/", pinned: true }, "https://a.example/"]);
    const ports = fake.ports();
    const t = await ports.tabs.create({
      windowId: w,
      url: "https://n.example/",
      index: 0,
      active: true,
    });
    expect(fake.tabsOf(w)[1]?.id).toBe(t.id);
    expect(fake.tabsOf(w).find((x) => x.active)?.id).toBe(t.id);
    const removedWindows: number[] = [];
    ports.events.onWindowRemoved((id) => removedWindows.push(id));
    for (const id of fake.tabsOf(w).map((x) => x.id)) fake.closeTab(id);
    expect(removedWindows).toEqual([w]);
    expect(await ports.windows.get(w)).toBeNull();
    await expect(ports.tabs.create({ windowId: w, url: "x", active: false })).rejects.toThrow();
    const nw = await ports.windows.create({});
    expect(nw.tabs.map((x) => x.url)).toEqual(["chrome://newtab/"]);
  });

  it("storage onChanged and alarms", async () => {
    const fake = new FakeBrowser();
    const ports = fake.ports();
    const changes: string[] = [];
    const off = ports.local.onChanged((c) => changes.push(...Object.keys(c)));
    await ports.local.set({ a: 1 });
    await ports.local.remove(["a", "missing"]);
    off();
    await ports.local.set({ b: 1 });
    expect(changes).toEqual(["a", "a"]);
    await ports.alarms.create("x", { periodInMinutes: 1 });
    expect(await ports.alarms.getAll()).toEqual(["x"]);
    await ports.alarms.clear("x");
    expect(await ports.local.getMany(["b", "zz"])).toEqual({ b: 1 });
  });
});

describe("detectDirectSchemes", () => {
  it("adds the running browser's own internal scheme only", () => {
    expect(
      detectDirectSchemes({ userAgentData: { brands: [{ brand: "Google Chrome" }] } }),
    ).toEqual(["chrome:", "about:"]);
    expect(
      detectDirectSchemes({ userAgentData: { brands: [{ brand: "Microsoft Edge" }] } }),
    ).toContain("edge:");
    expect(detectDirectSchemes({ userAgentData: { brands: [{ brand: "Brave" }] } })).toContain(
      "brave:",
    );
    expect(detectDirectSchemes(undefined)).toEqual(["chrome:", "about:"]);
  });
});
