import { describe, expect, it } from "vitest";
import type { BackupFile, WindowState, WorkspaceMeta, WorkspaceTabs } from "../core/model/types";
import { Keys } from "../core/model/types";
import { seedWorkspace, setup, stored } from "./testing/harness";

describe("BackupService", () => {
  it("round trip: export -> replace import into a fresh profile", async () => {
    const src = await setup({
      before: (fake) => {
        seedWorkspace(fake, "A", ["https://a.example/1", "https://a.example/2"]);
        seedWorkspace(fake, "B", ["https://b.example/1"]);
      },
    });
    await src.ok("todo.set", {
      scope: "A",
      items: [{ id: "t1", text: "do", done: false, order: 0, createdAt: 1 }],
    });
    await src.ok("note.set", { scope: "global", content: "hello" });
    await src.ok("quicklink.set", {
      items: [{ id: "q", url: "https://q.example/", title: "Q", order: 0 }],
    });
    const file = await src.ok("backup.export", {});
    expect(file.data.workspaces.map((w) => w.meta.id)).toEqual(["A", "B"]);

    const dst = await setup({ windows: [["https://live.example/"]] });
    const w = dst.fake.windowIds()[0] as number;
    await dst.svc.tracker.flush(w);
    const json = JSON.parse(JSON.stringify(file)) as BackupFile;
    const report = await dst.ok("backup.import", { file: json, mode: "replace" });
    expect(report).toMatchObject({ workspaces: 2, todos: 1, notes: 1, quicklinks: 1 });
    expect(stored<string[]>(dst.fake, Keys.wsIndex)).toEqual(["A", "B"]);
    expect(stored<WorkspaceTabs>(dst.fake, Keys.wsTabs("A"))?.tabs.map((t) => t.url)).toEqual([
      "https://a.example/1",
      "https://a.example/2",
    ]);
    expect(stored(dst.fake, Keys.importStaging)).toBeUndefined();
    // the live window pointed at an Unsorted workspace the replace dropped -> reset, tabs untouched
    expect(stored<WindowState>(dst.fake, Keys.window(w))?.activeWorkspaceId).toBeNull();
    expect(dst.fake.urlsOf(w)).toEqual(["https://live.example/"]);
    const again = await dst.ok("backup.export", {});
    expect(again.data.workspaces.map((x) => x.tabs)).toEqual(
      file.data.workspaces.map((x) => x.tabs),
    );
  });

  it("merge keeps existing workspaces", async () => {
    const h = await setup({ before: (fake) => seedWorkspace(fake, "A", ["https://a.example/"]) });
    const file = await h.ok("backup.export", {});
    const report = await h.ok("backup.import", { file, mode: "merge" });
    expect(report.workspaces).toBe(1);
    const index = stored<string[]>(h.fake, Keys.wsIndex) ?? [];
    expect(index).toHaveLength(2);
    expect(stored<WorkspaceMeta>(h.fake, Keys.wsMeta(index[1] ?? ""))?.name).toBe(
      "WS A (imported)",
    );
  });

  it("rejects invalid files and dangerous URLs without writing anything", async () => {
    const h = await setup({ before: (fake) => seedWorkspace(fake, "A", ["https://a.example/"]) });
    const before = JSON.stringify([...h.fake.local.entries()]);
    expect(
      await h.rpc("backup.import", { file: { format: "nope" }, mode: "replace" }),
    ).toMatchObject({
      code: "invalid",
    });
    const file = await h.ok("backup.export", {});
    const evil = structuredClone(file);
    (evil.data.workspaces[0]?.tabs.tabs[0] as { url: string }).url = "javascript:alert(1)";
    expect(await h.rpc("backup.import", { file: evil, mode: "replace" })).toMatchObject({
      code: "invalid",
    });
    expect(JSON.stringify([...h.fake.local.entries()])).toBe(before);
  });

  it("an import interrupted after staging is re-applied by init", async () => {
    const h = await setup({ before: (fake) => seedWorkspace(fake, "A", ["https://a.example/"]) });
    const file = await h.ok("backup.export", {});
    const first = file.data.workspaces[0];
    if (first) first.meta.name = "Renamed";
    // crash right after the staging write: the apply set never happens
    h.fake.failNext("storage.set", {
      when: (items) => !Object.keys(items as object).includes(Keys.importStaging),
    });
    expect((await h.rpc("backup.import", { file, mode: "replace" })).ok).toBe(false);
    expect(stored(h.fake, Keys.importStaging)).toBeDefined();
    await h.restart();
    expect(h.svc.initReport?.importReapplied).toBe(true);
    expect(stored<WorkspaceMeta>(h.fake, Keys.wsMeta("A"))?.name).toBe("Renamed");
    expect(stored(h.fake, Keys.importStaging)).toBeUndefined();
  });

  it("refuses to import while a switch op is pending", async () => {
    const h = await setup({
      windows: [["https://x.example/"]],
      before: (fake) => seedWorkspace(fake, "A", ["https://a.example/"]),
    });
    const w = h.fake.windowIds()[0] as number;
    h.fake.failNext("tabs.create");
    await h.rpc("workspace.switch", { windowId: w, workspaceId: "A" });
    const file = await h.ok("backup.export", {});
    expect(await h.rpc("backup.import", { file, mode: "merge" })).toMatchObject({ code: "busy" });
  });
});
