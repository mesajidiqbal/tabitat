import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceMeta, WorkspaceTabs } from "@/core/model/types";
import type { UiTab } from "./tabs";

// search.ts keeps its index in module state: every test gets fresh modules.
async function load() {
  vi.resetModules();
  const { store } = await import("./store");
  const search = await import("./search");
  return { store, ...search };
}

const meta = (id: string, name: string, over: Partial<WorkspaceMeta> = {}): WorkspaceMeta => ({
  id,
  name,
  color: "blue",
  kind: "named",
  resources: [],
  createdAt: 1,
  updatedAt: 1,
  rev: 1,
  ...over,
});
const saved = (...urls: Array<[string, string]>): WorkspaceTabs => ({
  tabs: urls.map(([url, title], index) => ({ id: `s${index}`, url, title, index })),
  updatedAt: 1,
  rev: 1,
});
const live = (id: number, title: string, url: string): UiTab => ({
  id,
  windowId: 1,
  index: id,
  url,
  rawUrl: url,
  title,
  pinned: false,
  active: false,
  audible: false,
  discarded: false,
  groupId: -1,
  placeholder: false,
});

beforeEach(() => {
  vi.resetModules();
});

describe("search", () => {
  it("follows incremental add / update / remove of live tabs", async () => {
    const { store, search } = await load();
    store.liveTabs.value = [live(1, "Quarterly report", "https://docs.example/q")];
    expect(search("quarterly").map((h) => h.key)).toEqual(["tab:1"]);

    store.liveTabs.value = [
      live(1, "Quarterly report", "https://docs.example/q"),
      live(2, "Quarterly plan", "https://docs.example/p"),
    ];
    expect(
      search("quarterly")
        .map((h) => h.key)
        .sort(),
    ).toEqual(["tab:1", "tab:2"]);

    store.liveTabs.value = [
      live(1, "Weather today", "https://weather.example/"),
      live(2, "Quarterly plan", "https://docs.example/p"),
    ];
    expect(search("quarterly").map((h) => h.key)).toEqual(["tab:2"]);
    expect(search("weather").map((h) => h.key)).toEqual(["tab:1"]);

    store.liveTabs.value = [live(1, "Weather today", "https://weather.example/")];
    expect(search("quarterly")).toEqual([]);
  });

  it("follows saved links and recently closed changes", async () => {
    const { store, search } = await load();
    store.metas.value = { A: meta("A", "Alpha") };
    expect(search("zebra")).toEqual([]);
    store.metas.value = {
      A: meta("A", "Alpha", {
        resources: [{ id: "l1", url: "https://zebra.example/", title: "Zebra facts", order: 0 }],
      } as Partial<WorkspaceMeta>),
    };
    expect(search("zebra").map((h) => [h.key, h.kind])).toEqual([["link:A:l1", "link"]]);
    store.recentlyClosed.value = [
      { id: "c1", url: "https://giraffe.example/", title: "Giraffe", closedAt: 1 },
    ];
    expect(search("giraffe").map((h) => h.kind)).toEqual(["closed"]);
    store.recentlyClosed.value = [];
    expect(search("giraffe")).toEqual([]);
  });

  it("excludes the current window's active workspace from saved tabs (its tabs are live)", async () => {
    const { store, search } = await load();
    store.windowId.value = 1;
    store.index.value = ["A", "B"];
    store.metas.value = { A: meta("A", "Alpha"), B: meta("B", "Beta") };
    store.wsTabs.value = {
      A: saved(["https://a.example/kiwi", "Kiwi in A"]),
      B: saved(["https://b.example/kiwi", "Kiwi in B"]),
    };
    store.windowStates.value = { 1: { activeWorkspaceId: "A" } as never };
    expect(search("kiwi").map((h) => h.key)).toEqual(["wt:B:s0"]);

    // Switching the window to B: A's saved tabs become searchable, B's are excluded.
    store.windowStates.value = { 1: { activeWorkspaceId: "B" } as never };
    expect(search("kiwi").map((h) => h.key)).toEqual(["wt:A:s0"]);
  });

  it("escapes HTML in titles (titleHtml is safe to inject)", async () => {
    const { store, search } = await load();
    store.liveTabs.value = [live(1, `<img src=x onerror="alert(1)"> mango`, "https://m.example/")];
    const [hit] = search("mango");
    expect(hit?.titleHtml).not.toContain("<img");
    expect(hit?.titleHtml).toContain("&lt;img");
    expect(hit?.titleHtml).toContain("<mark>");

    store.index.value = ["W"];
    store.metas.value = { W: meta("W", "<b>Papaya</b>") };
    const ws = search("papaya").find((h) => h.kind === "workspace");
    expect(ws?.titleHtml).toContain("&lt;b&gt;");
    expect(ws?.titleHtml).not.toContain("<b>");
  });

  it("Unsorted workspaces with ordinary ids are searchable (name and saved tabs)", async () => {
    const { store, search } = await load();
    store.windowId.value = 1;
    store.windowStates.value = { 1: { activeWorkspaceId: "named-1" } as never };
    store.index.value = ["named-1", "w-1700000000-abc"];
    store.metas.value = {
      "named-1": meta("named-1", "Work"),
      "w-1700000000-abc": meta("w-1700000000-abc", "Unsorted", { kind: "unsorted" }),
    };
    store.wsTabs.value = { "w-1700000000-abc": saved(["https://lychee.example/", "Lychee"]) };
    const byName = search("unsorted").find((h) => h.kind === "workspace");
    expect(byName?.workspaceId).toBe("w-1700000000-abc");
    const tab = search("lychee");
    expect(tab.map((h) => [h.kind, h.workspaceId])).toEqual([["workspaceTab", "w-1700000000-abc"]]);
  });
});
