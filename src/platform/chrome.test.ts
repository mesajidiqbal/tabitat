import { describe, expect, it } from "vitest";
import { toLiveTab } from "./chrome";

const raw = (over: Partial<chrome.tabs.Tab>): chrome.tabs.Tab =>
  ({
    id: 1,
    windowId: 2,
    index: 0,
    pinned: false,
    active: false,
    highlighted: false,
    incognito: false,
    selected: false,
    discarded: false,
    autoDiscardable: true,
    groupId: -1,
    frozen: false,
    ...over,
  }) as chrome.tabs.Tab;

describe("toLiveTab (pending navigations, review bug 3)", () => {
  it("a new tab with an empty committed url uses its pendingUrl", () => {
    const t = toLiveTab(raw({ url: "", pendingUrl: "https://slow.example/", status: "loading" }));
    expect(t?.url).toBe("https://slow.example/");
    expect(t?.pendingUrl).toBe("https://slow.example/");
    expect(t?.status).toBe("loading");
  });
  it("while loading, the pending destination wins over the committed url", () => {
    const t = toLiveTab(
      raw({ url: "about:blank", pendingUrl: "https://article.example/", status: "loading" }),
    );
    expect(t?.url).toBe("https://article.example/");
    const nav = toLiveTab(
      raw({ url: "https://old.example/", pendingUrl: "https://new.example/", status: "loading" }),
    );
    expect(nav?.url).toBe("https://new.example/");
  });
  it("complete tabs keep their committed url; missing urls map to empty", () => {
    expect(toLiveTab(raw({ url: "https://a.example/", status: "complete" }))?.url).toBe(
      "https://a.example/",
    );
    expect(toLiveTab(raw({}))?.url).toBe("");
    expect(toLiveTab(raw({ id: -1 }))).toBeNull();
  });
});
