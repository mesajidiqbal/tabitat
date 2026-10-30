import * as v from "valibot";
import { describe, expect, it } from "vitest";
import type {
  BackupFile,
  Trash,
  WindowState,
  WorkspaceMeta,
  WorkspaceTabs,
} from "../core/model/types";
import { Keys } from "../core/model/types";
import { isStagingKey, StagingSchema } from "./backup";
import { seedWorkspace, settle, setup, stored } from "./testing/harness";

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
    const index = stored<string[]>(dst.fake, Keys.wsIndex) ?? [];
    expect(index.slice(0, 2)).toEqual(["A", "B"]);
    expect(stored<WorkspaceTabs>(dst.fake, Keys.wsTabs("A"))?.tabs.map((t) => t.url)).toEqual([
      "https://a.example/1",
      "https://a.example/2",
    ]);
    expect(stored(dst.fake, Keys.importStaging)).toBeUndefined();
    // the live window's replaced (Unsorted) workspace went to the trash; the window was detached
    // and its live tabs adopted as a fresh Unsorted workspace; tabs untouched
    const trash = stored<Trash>(dst.fake, Keys.trash);
    expect(trash?.items.map((i) => i.kind === "workspace" && i.tabs.tabs[0]?.url)).toEqual([
      "https://live.example/",
    ]);
    const now = stored<WindowState>(dst.fake, Keys.window(w))?.activeWorkspaceId as string;
    expect(now).not.toBe(trash?.items[0]?.kind === "workspace" && trash.items[0].meta.id);
    expect(stored<WorkspaceMeta>(dst.fake, Keys.wsMeta(now))?.kind).toBe("unsorted");
    expect(index).toEqual(["A", "B", now]);
    expect(dst.fake.urlsOf(w)).toEqual(["https://live.example/"]);
    const again = await dst.ok("backup.export", {});
    expect(again.data.workspaces.slice(0, 2).map((x) => x.tabs)).toEqual(
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
    // the worker dies right after the staging write landed: the apply never happens
    h.fake.failAfterEffect("storage.set", {
      when: (items) => Object.keys(items as object).includes(Keys.importStaging),
    });
    void h.rpc("backup.import", { file, mode: "replace" });
    await settle(10);
    expect(stored(h.fake, Keys.importStaging)).toBeDefined();
    await h.restart();
    expect(h.svc.initReport?.importReapplied).toBe(true);
    expect(stored<WorkspaceMeta>(h.fake, Keys.wsMeta("A"))?.name).toBe("Renamed");
    expect(stored(h.fake, Keys.importStaging)).toBeUndefined();
  });

  it("replace import is reversible: old workspaces in the trash + a forced generation (D1)", async () => {
    const h = await setup({
      windows: [["https://live.example/"]],
      before: (fake) => {
        seedWorkspace(fake, "A", ["https://a.example/"]);
        seedWorkspace(fake, "OLD", ["https://old.example/1", "https://old.example/2"]);
      },
    });
    const gens = (stored<number[]>(h.fake, Keys.sessionsIndex) ?? []).length;
    const file = await h.ok("backup.export", {});
    file.data.workspaces = file.data.workspaces.filter((w) => w.meta.id === "A");
    await h.ok("backup.import", { file, mode: "replace" });
    expect(stored(h.fake, Keys.wsMeta("OLD"))).toBeUndefined();
    const trash = stored<Trash>(h.fake, Keys.trash)?.items ?? [];
    const old = trash.find((i) => i.kind === "workspace" && i.meta.id === "OLD");
    expect(old && old.kind === "workspace" && old.tabs.tabs.map((t) => t.url)).toEqual([
      "https://old.example/1",
      "https://old.example/2",
    ]);
    expect(trash.every((i) => typeof i.deletedAt === "number")).toBe(true);
    expect(trash.some((i) => i.kind === "workspace" && i.meta.id === "A")).toBe(true);
    expect((stored<number[]>(h.fake, Keys.sessionsIndex) ?? []).length).toBe(gens + 1);
    // restorable from the trash
    await h.ok("trash.restore", { trashId: old?.id as string });
    expect(stored(h.fake, Keys.wsMeta("OLD"))).toBeDefined();
  });

  it("replace import detaches windows showing a replaced workspace, surviving ids included (D2)", async () => {
    const h = await setup({
      windows: [["https://x.example/"]],
      before: (fake) => seedWorkspace(fake, "A", ["https://x.example/"]),
      services: { debounceMs: 60_000 },
    });
    const w = h.fake.windowIds()[0] as number;
    // the window shows A (reconciled by similarity, live X); the file has A with Y
    expect(stored<WindowState>(h.fake, Keys.window(w))?.activeWorkspaceId).toBe("A");
    const file = await h.ok("backup.export", {});
    const tabs0 = file.data.workspaces[0]?.tabs.tabs[0];
    if (tabs0) tabs0.url = "https://y.example/";
    await h.ok("backup.import", { file, mode: "replace" });
    const st = stored<WindowState>(h.fake, Keys.window(w));
    expect(st?.activeWorkspaceId).not.toBe("A");
    expect(stored<WorkspaceMeta>(h.fake, Keys.wsMeta(st?.activeWorkspaceId ?? ""))?.kind).toBe(
      "unsorted",
    );
    // activity in the window no longer overwrites the imported A
    const tab = h.fake.tabsOf(w)[0]?.id as number;
    h.fake.navigate(tab, "https://z.example/");
    await settle();
    await h.svc.tracker.flush(w);
    expect(stored<WorkspaceTabs>(h.fake, Keys.wsTabs("A"))?.tabs.map((t) => t.url)).toEqual([
      "https://y.example/",
    ]);
  });

  it("staged replay is revision-aware and never overwrites a later edit (D3)", async () => {
    const h = await setup({ before: (fake) => seedWorkspace(fake, "A", ["https://a.example/"]) });
    await h.ok("note.set", { scope: "global", content: "v1" }); // rev 1
    // a staged import (as written by importBackup) whose base rev for the note was 1
    h.fake.local.set(Keys.importStaging, {
      set: {
        [Keys.notes("global")]: { content: "imported", updatedAt: 1, rev: 2 },
        [Keys.wsIndex]: ["A"],
        [Keys.wsMeta("A")]: { ...stored<WorkspaceMeta>(h.fake, Keys.wsMeta("A")), name: "Imp" },
      },
      remove: [],
      baseRevs: { [Keys.notes("global")]: 1, [Keys.wsMeta("A")]: 1 },
      startedAt: 1,
    });
    // ...then the user edited the note (rev 2 -> 3) and created workspace C
    h.fake.local.set(Keys.notes("global"), { content: "later edit", updatedAt: 2, rev: 3 });
    seedWorkspace(h.fake, "C", ["https://c.example/"]);
    await h.restart();
    expect(h.svc.initReport?.importReapplied).toBe(true);
    expect(stored<{ content: string }>(h.fake, Keys.notes("global"))?.content).toBe("later edit");
    expect(stored<WorkspaceMeta>(h.fake, Keys.wsMeta("A"))?.name).toBe("Imp");
    expect(stored<string[]>(h.fake, Keys.wsIndex)).toEqual(["A", "C"]);
  });

  it("a staged import that fails twice moves to import:failed; init completes (D3)", async () => {
    const h = await setup({ before: (fake) => seedWorkspace(fake, "A", ["https://a.example/"]) });
    h.fake.local.set(Keys.importStaging, {
      set: { [Keys.wsIndex]: ["A"] },
      remove: [],
      baseRevs: {},
      startedAt: 1,
    });
    h.svc.stop();
    h.fake.killWorker();
    h.fake.failNext("storage.set", {
      times: 2,
      when: (items) => Object.keys(items as object).includes(Keys.wsIndex),
    });
    await h.restart();
    expect(h.svc.initReport?.importFailed).toBe(true);
    expect(stored(h.fake, Keys.importStaging)).toBeUndefined();
    expect(stored<{ error: string }>(h.fake, "import:failed")?.error).toMatch(/injected/);
    expect(await h.ok("system.ping", {})).toMatchObject({ ready: true });
    expect((await h.rpc("note.set", { scope: "global", content: "x" })).ok).toBe(true);
  });

  it("an import whose apply fails is set aside and reported, not left staged", async () => {
    const h = await setup({ before: (fake) => seedWorkspace(fake, "A", ["https://a.example/"]) });
    const file = await h.ok("backup.export", {});
    h.fake.failNext("storage.set", {
      times: 2,
      when: (items) => Object.keys(items as object).includes(Keys.wsIndex),
    });
    expect(await h.rpc("backup.import", { file, mode: "merge" })).toMatchObject({
      ok: false,
      code: "internal",
      retryable: true,
    });
    expect(stored(h.fake, Keys.importStaging)).toBeUndefined();
    expect(stored(h.fake, "import:failed")).toBeDefined();
  });

  it("rejects oversized imports with code limit (D4)", async () => {
    const h = await setup();
    const file = await h.ok("backup.export", {});
    const ws = (i: number) => ({
      meta: {
        id: `w${i}`,
        name: "",
        color: "grey",
        kind: "named",
        resources: [],
        createdAt: 1,
        updatedAt: 1,
        rev: 0,
      },
      tabs: { tabs: [], updatedAt: 1, rev: 0 },
    });
    const many = {
      ...file,
      data: { ...file.data, workspaces: Array.from({ length: 1001 }, (_, i) => ws(i)) },
    };
    expect(await h.rpc("backup.import", { file: many, mode: "merge" })).toMatchObject({
      ok: false,
      code: "limit",
    });
    const huge = { ...file, padding: "x".repeat(25 * 1024 * 1024 + 1) };
    expect(await h.rpc("backup.import", { file: huge, mode: "merge" })).toMatchObject({
      code: "limit",
    });
  });

  it("staging only accepts known key families and valid records (D5)", async () => {
    const h = await setup();
    h.fake.local.set(Keys.importStaging, {
      set: { [Keys.window(1)]: { activeWorkspaceId: "x", sessionEpoch: "e" } },
      remove: [],
      startedAt: 1,
    });
    await h.restart();
    expect(stored(h.fake, Keys.window(1))).toBeUndefined();
    expect(stored(h.fake, `corrupt:${Keys.importStaging}`)).toBeDefined();
    expect(isStagingKey("ws:meta:A")).toBe(true);
    expect(isStagingKey("ws:meta:bad id")).toBe(false);
    expect(isStagingKey("op:switch:1")).toBe(false);
    expect(isStagingKey("todos:global")).toBe(true);
    expect(
      v.is(StagingSchema, { set: { [Keys.wsTabs("A")]: { tabs: "x" } }, remove: [], startedAt: 1 }),
    ).toBe(false);
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

  it("while staging survives a runtime failure, mutating commands answer busy (T1)", async () => {
    const h = await setup({ before: (fake) => seedWorkspace(fake, "A", ["https://a.example/"]) });
    const file = await h.ok("backup.export", {});
    const name = file.data.workspaces[0];
    if (name) name.meta.name = "Imported";
    // removing import:staging keeps failing: neither apply nor the move to import:failed completes
    const stagingRemove = (keys: unknown) =>
      (Array.isArray(keys) ? keys : [keys]).includes(Keys.importStaging);
    h.fake.failNext("storage.remove", { times: 6, when: stagingRemove });
    expect((await h.rpc("backup.import", { file, mode: "replace" })).ok).toBe(false);
    expect(stored(h.fake, Keys.importStaging)).toBeDefined();
    // a mutating command is refused while the import is unresolved; reads still work
    expect(await h.rpc("settings.update", { patch: { theme: "dark" } })).toMatchObject({
      ok: false,
      code: "busy",
    });
    expect((await h.rpc("backup.export", {})).ok).toBe(true);
    // once storage recovers, the next command resolves the import first, then runs
    h.fake.clearFailures();
    expect((await h.rpc("settings.update", { patch: { theme: "dark" } })).ok).toBe(true);
    expect(stored(h.fake, Keys.importStaging)).toBeUndefined();
    expect(stored(h.fake, "import:failed")).toBeUndefined(); // resolved after all
    // the acknowledged edit survives a restart (no replay over it)
    await h.restart();
    expect(stored<{ theme: string }>(h.fake, Keys.settings)?.theme).toBe("dark");
    expect(stored<WorkspaceMeta>(h.fake, Keys.wsMeta("A"))?.name).toBe("Imported");
  });

  it("legacy staging without baseRevs is never applied blindly (T2)", async () => {
    const h = await setup({ before: (fake) => seedWorkspace(fake, "A", ["https://a.example/"]) });
    h.fake.local.set(Keys.importStaging, {
      set: { [Keys.wsTabs("A")]: { tabs: [], updatedAt: 1, rev: 0 } },
      remove: [],
      startedAt: 1,
    });
    await h.restart();
    expect(h.svc.initReport?.importFailed).toBe(true);
    expect(stored(h.fake, Keys.importStaging)).toBeUndefined();
    expect(stored<{ reason: string }>(h.fake, "import:failed")?.reason).toBe("legacy_staging");
    expect(stored<WorkspaceTabs>(h.fake, Keys.wsTabs("A"))?.tabs).toHaveLength(1);
  });

  it("settings and quick links are revision-guarded on replay (T3)", async () => {
    const h = await setup();
    await h.ok("settings.update", { patch: { theme: "light" } });
    const rev = stored<{ rev: number }>(h.fake, Keys.settings)?.rev as number;
    h.fake.local.set(Keys.importStaging, {
      set: {
        [Keys.settings]: { ...stored<object>(h.fake, Keys.settings), theme: "dark", rev: rev + 5 },
        [Keys.quicklinks]: { items: [], rev: 9 },
      },
      remove: [],
      baseRevs: { [Keys.settings]: rev - 1, [Keys.quicklinks]: 0 },
      startedAt: 1,
    });
    h.fake.local.set(Keys.quicklinks, {
      items: [{ id: "q", url: "https://q.example/", title: "Q", order: 0 }],
      rev: 3,
    });
    await h.restart();
    expect(stored<{ theme: string }>(h.fake, Keys.settings)?.theme).toBe("light");
    expect(stored<{ items: unknown[] }>(h.fake, Keys.quicklinks)?.items).toHaveLength(1);
  });

  it("replace import archives replaced notes and todos; trash.restore brings them back (T4)", async () => {
    const h = await setup({ before: (fake) => seedWorkspace(fake, "A", ["https://a.example/"]) });
    await h.ok("note.set", { scope: "global", content: "keep me" });
    await h.ok("note.set", { scope: "A", content: "A's note" });
    await h.ok("todo.set", {
      scope: "global",
      items: [{ id: "t1", text: "old todo", done: false, order: 0, createdAt: 1 }],
    });
    const file = await h.ok("backup.export", {});
    file.data.notes = {};
    file.data.todos = {};
    await h.ok("backup.import", { file, mode: "replace" });
    expect(stored(h.fake, Keys.notes("global"))).toBeUndefined();
    const trash = stored<Trash>(h.fake, Keys.trash)?.items ?? [];
    const notes = trash.filter((i) => i.kind === "note");
    expect(notes.map((i) => i.kind === "note" && [i.scope, i.note.content]).sort()).toEqual([
      ["A", "A's note"],
      ["global", "keep me"],
    ]);
    const todos = trash.find((i) => i.kind === "todos");
    expect(todos && todos.kind === "todos" && todos.list.items[0]?.text).toBe("old todo");
    for (const item of [...notes, todos])
      await h.ok("trash.restore", { trashId: item?.id as string });
    expect(stored<{ content: string }>(h.fake, Keys.notes("global"))?.content).toBe("keep me");
    expect(stored<{ content: string }>(h.fake, Keys.notes("A"))?.content).toBe("A's note");
    expect(
      stored<{ items: Array<{ text: string }> }>(h.fake, Keys.todos("global"))?.items[0]?.text,
    ).toBe("old todo");
  });

  it("a note restored into a deleted workspace's scope goes to global, appended (T4)", async () => {
    const h = await setup({ before: (fake) => seedWorkspace(fake, "A", ["https://a.example/"]) });
    await h.ok("note.set", { scope: "global", content: "current" });
    h.fake.local.set(Keys.trash, {
      items: [
        {
          id: "n1",
          kind: "note",
          deletedAt: h.fake.clock,
          scope: "gone",
          note: { content: "archived", updatedAt: 1, rev: 1 },
        },
      ],
    });
    await h.ok("trash.restore", { trashId: "n1" });
    expect(stored<{ content: string }>(h.fake, Keys.notes("global"))?.content).toBe(
      "current\n\narchived",
    );
  });

  it("a failure after records were written reports partial: true with the applied keys (T5)", async () => {
    const h = await setup({
      before: (fake) => {
        seedWorkspace(fake, "A", ["https://a.example/"]);
        seedWorkspace(fake, "OLD", ["https://old.example/"]);
      },
    });
    const file = await h.ok("backup.export", {});
    file.data.workspaces = file.data.workspaces.filter((w) => w.meta.id === "A");
    // the set lands, the removals of OLD keep failing
    h.fake.failNext("storage.remove", {
      times: 10,
      when: (keys) => (Array.isArray(keys) ? keys : [keys]).includes(Keys.wsMeta("OLD")),
    });
    const env = await h.rpc("backup.import", { file, mode: "replace" });
    expect(env).toMatchObject({ ok: false, code: "internal", retryable: true });
    if (env.ok) throw new Error("unreachable");
    expect(env.message).toMatch(/partially applied/);
    expect(env.details).toMatchObject({ partial: true });
    expect(env.details?.applied).toEqual(expect.arrayContaining([Keys.wsMeta("A"), Keys.wsIndex]));
    expect(stored<{ partial: boolean; applied: string[] }>(h.fake, "import:failed")).toMatchObject({
      partial: true,
    });
    expect(stored(h.fake, Keys.importStaging)).toBeUndefined();
  });
});
