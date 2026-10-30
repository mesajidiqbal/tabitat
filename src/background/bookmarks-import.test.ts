import { describe, expect, it } from "vitest";
import type { QuickLinks, WorkspaceMeta, WorkspaceTabs } from "../core/model/types";
import { Keys, LIMITS } from "../core/model/types";
import type { BookmarkEntry } from "../messaging/commands";
import { seedWorkspace, setup, stored } from "./testing/harness";

const bm = (path: string[], url: string, title = url): BookmarkEntry => ({ path, title, url });

describe("import.bookmarks", () => {
  it("into quick links: appends after existing ones with rev + 1, deduped", async () => {
    const h = await setup();
    await h.ok("quicklink.set", {
      items: [{ id: "q1", url: "https://a.example/", title: "A", order: 4 }],
    });
    const report = await h.ok("import.bookmarks", {
      entries: [
        bm(["Bar"], "https://a.example"),
        bm(["Bar"], "https://b.example/", "B"),
        bm(["Bar"], "edge://flags/"),
      ],
      target: { kind: "quicklinks" },
    });
    expect(report).toEqual({
      added: 1,
      skipped: 2,
      workspaces: [],
      warnings: ["unsupported:1", "duplicates:1"],
    });
    const ql = stored<QuickLinks>(h.fake, Keys.quicklinks);
    expect(ql?.rev).toBe(2);
    expect(ql?.items.map((q) => [q.url, q.title, q.order])).toEqual([
      ["https://a.example/", "A", 4],
      ["https://b.example/", "B", 5],
    ]);
  });

  it("into quick links: respects the total limit", async () => {
    const h = await setup();
    const entries = Array.from({ length: LIMITS.quickLinks + 5 }, (_, i) =>
      bm(["Bar"], `https://q.example/${i}`),
    );
    const report = await h.ok("import.bookmarks", { entries, target: { kind: "quicklinks" } });
    expect(report).toMatchObject({ added: LIMITS.quickLinks, skipped: 5 });
    expect(report.warnings).toEqual(["quicklinks_limit:5"]);
    expect(stored<QuickLinks>(h.fake, Keys.quicklinks)?.items).toHaveLength(LIMITS.quickLinks);
  });

  it("into one workspace: saved links in resources, empty tabs, appended to ws:index", async () => {
    const h = await setup({ before: (f) => seedWorkspace(f, "A", []) });
    const w0 = h.fake.windowIds().length;
    const report = await h.ok("import.bookmarks", {
      entries: [
        bm(["Bar", "Work"], "https://w1.example/", "W1"),
        bm(["Bar"], "https://w2.example/"),
      ],
      target: { kind: "workspace", name: "Work", color: "green" },
    });
    expect(report).toMatchObject({ added: 2, skipped: 0, warnings: [] });
    expect(report.workspaces).toHaveLength(1);
    const id = report.workspaces[0] as string;
    const meta = stored<WorkspaceMeta>(h.fake, Keys.wsMeta(id));
    expect(meta).toMatchObject({ name: "Work", color: "green", kind: "named", rev: 1 });
    expect(meta?.resources.map((r) => [r.url, r.title, r.order])).toEqual([
      ["https://w1.example/", "W1", 0],
      ["https://w2.example/", "https://w2.example/", 1],
    ]);
    expect(stored<WorkspaceTabs>(h.fake, Keys.wsTabs(id))?.tabs).toEqual([]);
    expect(stored<string[]>(h.fake, Keys.wsIndex)?.at(-1)).toBe(id);
    expect(stored<string[]>(h.fake, Keys.wsIndex)?.[0]).toBe("A");
    // never touches live windows
    expect(h.fake.windowIds()).toHaveLength(w0);
    expect(h.fake.calls).not.toContain("tabs.create");
    expect(h.fake.calls).not.toContain("windows.create");
  });

  it("one workspace per folder, including root-level links", async () => {
    const h = await setup();
    const report = await h.ok("import.bookmarks", {
      entries: [
        bm(["Bar", "Dev", "Docs"], "https://d.example/"),
        bm(["Bar", "Dev"], "https://root.example/"),
        bm(["Bar", "Dev", "Tools", "Sub"], "https://t.example/"),
      ],
      target: { kind: "workspacePerFolder", color: "blue" },
    });
    expect(report).toMatchObject({ added: 3, skipped: 0 });
    const metas = report.workspaces.map((id) => stored<WorkspaceMeta>(h.fake, Keys.wsMeta(id)));
    expect(metas.map((m) => [m?.name, m?.color, m?.resources.map((r) => r.url)])).toEqual([
      ["Docs", "blue", ["https://d.example/"]],
      ["Dev", "blue", ["https://root.example/"]],
      ["Tools", "blue", ["https://t.example/"]],
    ]);
    expect(stored<string[]>(h.fake, Keys.wsIndex)).toEqual(report.workspaces);
  });

  it("is atomic: a failed write leaves nothing behind", async () => {
    const h = await setup({ before: (f) => seedWorkspace(f, "A", []) });
    const index = stored<string[]>(h.fake, Keys.wsIndex);
    const keys = [...h.fake.local.keys()].sort();
    h.fake.failNext("storage.set");
    const env = await h.rpc("import.bookmarks", {
      entries: [bm(["R", "X"], "https://x.example/"), bm(["R", "Y"], "https://y.example/")],
      target: { kind: "workspacePerFolder", color: "red" },
    });
    expect(env).toMatchObject({ ok: false, code: "internal" });
    expect([...h.fake.local.keys()].sort()).toEqual(keys);
    expect(stored<string[]>(h.fake, Keys.wsIndex)).toEqual(index);

    const before = stored<QuickLinks>(h.fake, Keys.quicklinks);
    h.fake.failNext("storage.set");
    const ql = await h.rpc("import.bookmarks", {
      entries: [bm(["R"], "https://x.example/")],
      target: { kind: "quicklinks" },
    });
    expect(ql).toMatchObject({ ok: false });
    expect(stored(h.fake, Keys.quicklinks)).toEqual(before);
  });

  it("rejects dangerous URLs at the schema", async () => {
    const h = await setup();
    for (const url of ["javascript:alert(1)", "data:text/html,x", "vbscript:x"]) {
      expect(
        await h.rpc("import.bookmarks", { entries: [bm([], url)], target: { kind: "quicklinks" } }),
      ).toMatchObject({ ok: false, code: "invalid" });
    }
  });
});
