import { describe, expect, it } from "vitest";
import { detectDirectSchemes } from "./brand";
import { isNoTabError } from "./errors";
import { FakeBrowser, WorkerKilledError } from "./fake";

describe("FakeBrowser fidelity", () => {
  it("tabs.remove([valid, stale]) behaves like the chrome.ts port (stale ids ignored)", async () => {
    const fake = new FakeBrowser();
    const w = fake.addWindow(["https://a.example/", "https://b.example/"]);
    const [a] = fake.tabsOf(w).map((t) => t.id) as [number];
    await fake.ports().tabs.remove([a, 424242]);
    expect(fake.hasTab(a)).toBe(false);
    expect(isNoTabError(new Error("No tab with id: 5."))).toBe(true);
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
    expect(removedWindows).toEqual([]); // events are delivered asynchronously
    await Promise.resolve();
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

describe("FakeBrowser fidelity — review §3 divergences", () => {
  it("failAfterEffect: the browser performs the call, the worker never gets the result", async () => {
    const fake = new FakeBrowser();
    const w = fake.addWindow(["https://a.example/"]);
    const ports = fake.ports();
    fake.failAfterEffect("tabs.create");
    const err = await ports.tabs
      .create({ windowId: w, url: "https://n.example/", active: false })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WorkerKilledError);
    expect(fake.urlsOf(w)).toEqual(["https://a.example/", "https://n.example/"]);
    // the old worker is dead: its ports hang
    let settled = false;
    void ports.local.get("x").then(() => {
      settled = true;
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(settled).toBe(false);
  });

  it("killWorker rejects in-flight calls so old continuations stop", async () => {
    const fake = new FakeBrowser();
    const ports = fake.ports();
    const p = ports.local.set({ a: 1 });
    fake.killWorker();
    await expect(p).rejects.toBeInstanceOf(WorkerKilledError);
    expect(fake.local.get("a")).toBe(1); // the effect happened browser-side
  });

  it("restartBrowser({ keepTabs }) restores only some tabs; empty windows are dropped", async () => {
    const fake = new FakeBrowser();
    fake.addWindow(["https://a.example/", "https://b.example/", "https://c.example/"]);
    fake.addWindow(["https://gone.example/"]);
    fake.restart({ keepTabs: (t) => !t.url.includes("b.") && !t.url.includes("gone") });
    expect(fake.windowIds()).toHaveLength(1);
    expect(fake.urlsOf(fake.windowIds()[0] as number)).toEqual([
      "https://a.example/",
      "https://c.example/",
    ]);
  });

  it("tabs.get / windows.get resolve null on failure, like the chrome.ts adapters", async () => {
    const fake = new FakeBrowser();
    const w = fake.addWindow(["https://a.example/"]);
    const ports = fake.ports();
    fake.failNext("tabs.get");
    fake.failNext("windows.get");
    expect(await ports.tabs.get(fake.tabsOf(w)[0]?.id as number)).toBeNull();
    expect(await ports.windows.get(w)).toBeNull();
    expect(await ports.windows.get(w)).not.toBeNull();
  });

  it("pending navigations and API-created tabs map like chrome.ts", async () => {
    const fake = new FakeBrowser();
    const w = fake.addWindow(["about:blank"]);
    const id = fake.tabsOf(w)[0]?.id as number;
    fake.navigate(id, "https://slow.example/", { commit: false });
    expect(fake.tab(id)).toMatchObject({
      url: "https://slow.example/",
      pendingUrl: "https://slow.example/",
      status: "loading",
    });
    fake.commitNavigation(id, "Slow");
    expect(fake.tab(id)).toMatchObject({ url: "https://slow.example/", title: "Slow" });
    expect(fake.tab(id)?.pendingUrl).toBeUndefined();
    const t = await fake
      .ports()
      .tabs.create({ windowId: w, url: "https://n.example/", active: false });
    expect(t).toMatchObject({ url: "https://n.example/", pendingUrl: "https://n.example/" });
  });

  it("grouping a pinned tab throws; moveTab and setPinned emit events", async () => {
    const fake = new FakeBrowser();
    const w1 = fake.addWindow([{ url: "https://p.example/", pinned: true }, "https://a.example/"]);
    const w2 = fake.addWindow(["https://b.example/"]);
    const ports = fake.ports();
    const seen: string[] = [];
    ports.events.onTabDetached(() => seen.push("detached"));
    ports.events.onTabAttached(() => seen.push("attached"));
    ports.events.onTabUpdated((_id, c) => seen.push(`pinned:${c.pinned}`));
    const [p, a] = fake.tabsOf(w1).map((t) => t.id) as [number, number];
    await expect(ports.tabs.group([p], w1)).rejects.toThrow(/pinned/);
    fake.moveTab(a, w2);
    fake.setPinned(a, true);
    await Promise.resolve();
    expect(fake.tab(a)).toMatchObject({ windowId: w2, pinned: true });
    expect(seen).toEqual(["detached", "attached", "pinned:true"]);
  });

  it("storage round-trips through JSON", async () => {
    const fake = new FakeBrowser();
    await fake.ports().local.set({ k: { a: undefined, d: new Date(0) } });
    expect(fake.local.get("k")).toEqual({ d: "1970-01-01T00:00:00.000Z" });
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
