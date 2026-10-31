import { describe, expect, it } from "vitest";
import type { Meta, PomodoroState, Trash, WorkspaceMeta } from "../core/model/types";
import { Keys } from "../core/model/types";
import type { CommandType } from "../messaging/commands";
import { PayloadSchemas } from "../messaging/schemas";
import { badgeText } from "./badge";
import { seedWorkspace, settle, setup, stored } from "./testing/harness";

const todo = (id: string) => ({ id, text: id, done: false, order: 0, createdAt: 1 });

describe("command registration", () => {
  it("registers every command in the contract", async () => {
    const h = await setup();
    const all = Object.keys(PayloadSchemas) as CommandType[];
    for (const t of all) expect(h.svc.router.has(t)).toBe(true);
    expect(h.svc.router.registered().sort()).toEqual([...all].sort());
  });
});

describe("record commands", () => {
  it("todo.set / note.set / quicklink.set with expectedRev conflicts", async () => {
    const h = await setup({ before: (f) => seedWorkspace(f, "A", []) });
    expect(await h.ok("todo.set", { scope: "global", items: [todo("a")] })).toEqual({ rev: 1 });
    expect(await h.rpc("todo.set", { scope: "global", items: [], expectedRev: 0 })).toMatchObject({
      code: "conflict",
      retryable: true,
    });
    expect(await h.ok("todo.set", { scope: "A", items: [todo("b")], expectedRev: 0 })).toEqual({
      rev: 1,
    });
    expect(await h.rpc("todo.set", { scope: "missing", items: [] })).toMatchObject({
      code: "not_found",
    });

    const note = await h.ok("note.set", { scope: "global", content: "hi" });
    expect(note).toMatchObject({ content: "hi", rev: 1 });
    expect(
      await h.rpc("note.set", { scope: "global", content: "x", expectedRev: 5 }),
    ).toMatchObject({
      code: "conflict",
    });

    expect(
      await h.rpc("quicklink.set", {
        items: [{ id: "q", url: "javascript:alert(1)", title: "", order: 0 }],
      }),
    ).toMatchObject({ code: "invalid" });
    expect(
      await h.ok("quicklink.set", {
        items: [{ id: "q", url: "https://q.example/", title: "Q", order: 0 }],
      }),
    ).toEqual({ rev: 1 });
  });

  it("settings.update merges sections and validates the result", async () => {
    const h = await setup();
    const s = await h.ok("settings.update", { patch: { suspend: { afterMinutes: 45 } as never } });
    expect(s.suspend).toEqual({ enabled: false, afterMinutes: 45, whitelist: [] });
    expect(s.rev).toBe(1);
    expect(await h.rpc("settings.update", { patch: { restoreLimit: -1 } })).toMatchObject({
      code: "invalid",
    });
    expect(await h.rpc("settings.update", { patch: { bogus: 1 } as never })).toMatchObject({
      code: "invalid",
    });
    const many = Array.from({ length: 201 }, (_, i) => `h${i}.example`);
    const over = await h.rpc("settings.update", {
      patch: { suspend: { whitelist: many } as never },
    });
    expect(over).toMatchObject({ ok: false, code: "invalid" });
    expect(over.ok ? "" : over.message).toMatch(/whitelist/);
    const long = await h.rpc("settings.update", {
      patch: { suspend: { whitelist: ["a".repeat(254)] } as never },
    });
    expect(long).toMatchObject({ ok: false, code: "invalid" });
    expect(long.ok ? "" : long.message).toMatch(/whitelist/);
    expect(
      await h.rpc("settings.update", { patch: { theme: "dark" }, expectedRev: 0 }),
    ).toMatchObject({
      code: "conflict",
    });
  });

  it("workspace.update renames (Unsorted becomes named), reorder validates", async () => {
    const h = await setup({
      before: (f) => {
        seedWorkspace(f, "A", [], { kind: "unsorted" });
        seedWorkspace(f, "B", []);
      },
    });
    const m = await h.ok("workspace.update", {
      id: "A",
      patch: { name: "Work", emoji: "W" },
      expectedRev: 1,
    });
    expect(m).toMatchObject({ name: "Work", kind: "named", emoji: "W", rev: 2 });
    expect(
      await h.rpc("workspace.update", { id: "A", patch: { color: "red" }, expectedRev: 1 }),
    ).toMatchObject({
      code: "conflict",
    });
    const cleared = await h.ok("workspace.update", { id: "A", patch: { emoji: "", color: "red" } });
    expect(cleared.emoji).toBeUndefined();
    expect(cleared.color).toBe("red");
    expect(await h.rpc("workspace.update", { id: "Z", patch: {} })).toMatchObject({
      code: "not_found",
    });
    await h.ok("workspace.reorder", { ids: ["B", "A"] });
    expect(stored(h.fake, Keys.wsIndex)).toEqual(["B", "A"]);
    expect(await h.rpc("workspace.reorder", { ids: ["B"] })).toMatchObject({ code: "invalid" });
  });

  it("links: add, remove to trash, restore, purge", async () => {
    const h = await setup({ before: (f) => seedWorkspace(f, "A", []) });
    const link = await h.ok("link.add", {
      workspaceId: "A",
      url: "https://l.example/",
      title: "L",
    });
    expect(
      await h.rpc("link.add", { workspaceId: "A", url: "data:text/html,x", title: "" }),
    ).toMatchObject({
      code: "invalid",
    });
    const { trashId } = await h.ok("link.remove", { workspaceId: "A", linkId: link.id });
    expect(stored<WorkspaceMeta>(h.fake, Keys.wsMeta("A"))?.resources).toEqual([]);
    await h.ok("trash.restore", { trashId });
    expect(stored<WorkspaceMeta>(h.fake, Keys.wsMeta("A"))?.resources.map((r) => r.url)).toEqual([
      "https://l.example/",
    ]);
    expect(await h.rpc("link.remove", { workspaceId: "A", linkId: "nope" })).toMatchObject({
      code: "not_found",
    });
    const again = await h.ok("link.remove", { workspaceId: "A", linkId: link.id });
    expect(await h.ok("trash.purge", { trashId: again.trashId })).toBe(1);
    expect(await h.rpc("trash.purge", { trashId: again.trashId })).toMatchObject({
      code: "not_found",
    });
    expect(await h.rpc("trash.restore", { trashId: "x" })).toMatchObject({ code: "not_found" });
  });

  it("link.add is idempotent per URL: the existing link comes back, nothing is written", async () => {
    const h = await setup({ before: (f) => seedWorkspace(f, "A", []) });
    const first = await h.ok("link.add", {
      workspaceId: "A",
      url: "https://l.example/",
      title: "L",
    });
    const meta = stored<WorkspaceMeta>(h.fake, Keys.wsMeta("A"));
    const sets = h.fake.calls.filter((c) => c === "storage.set").length;
    const base = "chrome-extension://fakeextensionid/suspended.html";
    for (const url of [
      "https://l.example",
      `${base}#u=${encodeURIComponent("https://l.example/")}&t=L&w=A&s=1`,
    ]) {
      expect(await h.ok("link.add", { workspaceId: "A", url, title: "Other" })).toEqual(first);
    }
    expect(stored<WorkspaceMeta>(h.fake, Keys.wsMeta("A"))).toEqual(meta); // same rev
    expect(h.fake.calls.filter((c) => c === "storage.set").length).toBe(sets);
    // another URL is still added
    await h.ok("link.add", { workspaceId: "A", url: "https://m.example/", title: "M" });
    expect(stored<WorkspaceMeta>(h.fake, Keys.wsMeta("A"))?.rev).toBe((meta?.rev ?? 0) + 1);
  });

  it("tabs.park of an already saved URL returns the existing link and still closes the tab", async () => {
    const h = await setup({
      windows: [["https://keep.example/", "https://p.example/"]],
      before: (f) => seedWorkspace(f, "A", []),
    });
    const existing = await h.ok("link.add", {
      workspaceId: "A",
      url: "https://p.example/",
      title: "P",
    });
    const rev = stored<WorkspaceMeta>(h.fake, Keys.wsMeta("A"))?.rev;
    const w = h.fake.windowIds()[0] as number;
    const tab = h.fake.tabsOf(w)[1]?.id as number;
    expect(await h.ok("tabs.park", { tabId: tab, workspaceId: "A" })).toEqual(existing);
    expect(h.fake.hasTab(tab)).toBe(false);
    const meta = stored<WorkspaceMeta>(h.fake, Keys.wsMeta("A"));
    expect(meta?.resources).toEqual([existing]);
    expect(meta?.rev).toBe(rev);
  });

  it("trash: purge all, 30-day expiry alarm, restoring a workspace whose id is taken", async () => {
    const h = await setup({ before: (f) => seedWorkspace(f, "A", ["https://a.example/"]) });
    const { trashId } = await h.ok("workspace.delete", { id: "A" });
    seedWorkspace(h.fake, "A", []);
    await h.ok("trash.restore", { trashId });
    const index = stored<string[]>(h.fake, Keys.wsIndex) ?? [];
    expect(index).toHaveLength(2);
    await h.ok("workspace.delete", { id: index[1] as string });
    h.fake.advance(31 * 24 * 60 * 60 * 1000);
    await h.svc.onAlarm("trash-purge");
    expect(stored<Trash>(h.fake, Keys.trash)?.items).toEqual([]);
    await h.ok("workspace.delete", { id: "A" });
    expect(await h.ok("trash.purge", {})).toBe(1);
  });

  it("tabs.park saves the tab as a link before closing it", async () => {
    const base = "chrome-extension://fakeextensionid/suspended.html";
    const h = await setup({
      windows: [
        [
          "https://keep.example/",
          `${base}#u=${encodeURIComponent("https://p.example/")}&t=P&w=x&s=y`,
        ],
      ],
      before: (f) => seedWorkspace(f, "A", []),
    });
    const w = h.fake.windowIds()[0] as number;
    const tab = h.fake.tabsOf(w)[1]?.id as number;
    const link = await h.ok("tabs.park", { tabId: tab, workspaceId: "A" });
    expect(link.url).toBe("https://p.example/");
    expect(h.fake.hasTab(tab)).toBe(false);
    expect(await h.rpc("tabs.park", { tabId: 9999, workspaceId: "A" })).toMatchObject({
      code: "not_found",
    });
    const other = h.fake.openTab(w, "chrome-extension://other/x.html");
    expect(await h.rpc("tabs.park", { tabId: other, workspaceId: "A" })).toMatchObject({
      code: "invalid",
    });
  });
});

describe("suspender", () => {
  it("suspendOthers discards eligible tabs; ids are replaced", async () => {
    const h = await setup({
      windows: [
        [
          { url: "https://a.example/", active: true },
          "https://b.example/",
          { url: "https://c.example/", audible: true },
          { url: "https://d.example/", pinned: true },
          "chrome://settings/",
        ],
      ],
    });
    const w = h.fake.windowIds()[0] as number;
    expect(await h.ok("tabs.suspendOthers", { windowId: w })).toBe(1);
    expect(
      h.fake
        .tabsOf(w)
        .filter((t) => t.discarded)
        .map((t) => t.url),
    ).toEqual(["https://b.example/"]);
  });

  it("scan respects the setting and idle time", async () => {
    const h = await setup({
      windows: [
        [{ url: "https://a.example/", active: true }, "https://b.example/", "https://c.example/"],
      ],
    });
    expect(await h.svc.suspender.scan()).toBe(0);
    await h.ok("settings.update", {
      patch: { suspend: { enabled: true, afterMinutes: 30, whitelist: ["c.example"] } },
    });
    expect(await h.svc.suspender.scan()).toBe(0);
    h.fake.advance(31 * 60_000);
    await h.svc.onAlarm("suspend-scan");
    const w = h.fake.windowIds()[0] as number;
    expect(
      h.fake
        .tabsOf(w)
        .filter((t) => t.discarded)
        .map((t) => t.url),
    ).toEqual(["https://b.example/"]);
  });

  it("closeDuplicates keeps the active/most recent copy", async () => {
    const h = await setup({
      windows: [
        [{ url: "https://a.example/", active: true }, "https://a.example/#x", "https://b.example/"],
        ["https://b.example/"],
      ],
    });
    const [w1] = h.fake.windowIds() as [number];
    expect(await h.ok("tabs.closeDuplicates", { windowId: w1 })).toBe(1);
    expect(h.fake.urlsOf(w1)).toEqual(["https://a.example/", "https://b.example/"]);
    expect(await h.ok("tabs.closeDuplicates", {})).toBe(1);
  });
});

describe("pomodoro", () => {
  it("start / alarm / skip / stop", async () => {
    const h = await setup();
    const s = await h.ok("pomodoro.start", {});
    expect(s).toMatchObject({ phase: "work", round: 1 });
    expect(h.fake.alarms.get("pomodoro")?.when).toBe(s.endsAt);
    // early alarm re-arms
    await h.svc.onAlarm("pomodoro");
    expect(stored<PomodoroState>(h.fake, Keys.pomodoro)?.phase).toBe("work");
    h.fake.advance(25 * 60_000);
    await h.svc.onAlarm("pomodoro");
    expect(stored<PomodoroState>(h.fake, Keys.pomodoro)?.phase).toBe("break");
    expect(h.fake.notifications).toHaveLength(1);
    const skipped = await h.ok("pomodoro.skip", {});
    expect(skipped?.phase).toBe("work");
    expect(await h.ok("pomodoro.stop", {})).toBeNull();
    expect(h.fake.alarms.has("pomodoro")).toBe(false);
    expect(await h.ok("pomodoro.skip", {})).toBeNull();
    await h.svc.onAlarm("pomodoro");
  });
});

describe("shortcuts and badge", () => {
  it("toggle-side-panel / open-search open UI synchronously", async () => {
    const h = await setup({ windows: [["https://a.example/"]] });
    const w = h.fake.windowIds()[0] as number;
    h.fake.fireCommand("toggle-side-panel", { windowId: w });
    expect(h.fake.sidePanelOpened).toEqual([w]); // no await needed: synchronous
    h.fake.fireCommand("open-search", { windowId: w });
    expect(h.fake.popupOpened).toBe(1);
    h.fake.popupAvailable = false;
    h.fake.fireCommand("open-search", { windowId: w });
    expect(h.fake.sidePanelOpened).toEqual([w, w]);
  });

  it("next/prev workspace and suspend-other-tabs go through the router", async () => {
    const h = await setup({
      windows: [[{ url: "https://a.example/", active: true }, "https://b.example/"]],
      before: (f) => seedWorkspace(f, "B", ["https://bb.example/"]),
      services: { debounceMs: 60_000 },
    });
    const w = h.fake.windowIds()[0] as number;
    await h.ok("workspace.create", { name: "A", color: "red", fromWindowId: w });
    await h.svc.shortcuts.handle("next-workspace", { windowId: w });
    expect(stored<{ activeWorkspaceId: string }>(h.fake, Keys.window(w))?.activeWorkspaceId).toBe(
      "B",
    );
    await h.svc.shortcuts.handle("prev-workspace", { windowId: w });
    await h.svc.shortcuts.handle("suspend-other-tabs", { windowId: w });
    await h.svc.shortcuts.handle("unknown");
    await h.svc.shortcuts.handle("next-workspace");
    await settle();
  });

  it("badge shows the emoji or initial", async () => {
    expect(badgeText(null)).toBe("");
    const meta = {
      id: "a",
      name: "work",
      color: "red",
      kind: "named",
      resources: [],
      createdAt: 0,
      updatedAt: 0,
      rev: 0,
    } as WorkspaceMeta;
    expect(badgeText(meta)).toBe("W");
    expect(badgeText({ ...meta, emoji: "🚀" })).toBe("🚀");
    expect(badgeText({ ...meta, kind: "unsorted" })).toBe("");
    const h = await setup({
      windows: [["https://a.example/", "https://b.example/"]],
      services: { debounceMs: 60_000 },
    });
    const w = h.fake.windowIds()[0] as number;
    await h.ok("workspace.create", { name: "Zeta", color: "red", fromWindowId: w });
    const second = h.fake.tabsOf(w)[1]?.id as number;
    h.fake.activate(second);
    await settle();
    expect(h.fake.badges.get(second)).toBe("Z");
  });
});

describe("recovery screen commands", () => {
  const entry = (opId: string) => ({
    opId,
    windowId: 1,
    from: null,
    to: "A",
    stage: "opening",
    incoming: [],
    fromSnapshot: null,
    reason: "window closed",
    abandonedAt: 1,
  });
  const pending = (h: Awaited<ReturnType<typeof setup>>) =>
    stored<{ entries: Array<{ opId: string }> }>(h.fake, "recovery:pending");

  it("recovery.dismiss removes a subset, then everything; unknown ids remove nothing", async () => {
    const h = await setup();
    h.fake.local.set("recovery:pending", { entries: [entry("a"), entry("b"), entry("c")] });

    expect(await h.ok("recovery.dismiss", { opIds: ["b"] })).toBe(1);
    expect(pending(h)?.entries.map((e) => e.opId)).toEqual(["a", "c"]);

    expect(await h.ok("recovery.dismiss", { opIds: ["zzz"] })).toBe(0);
    expect(pending(h)?.entries.map((e) => e.opId)).toEqual(["a", "c"]);

    expect(await h.ok("recovery.dismiss", {})).toBe(2);
    expect(pending(h)).toBeUndefined();
    expect(await h.ok("recovery.dismiss", {})).toBe(0);
  });

  it("recovery.dismiss removes the record when the last entry goes", async () => {
    const h = await setup();
    h.fake.local.set("recovery:pending", { entries: [entry("a")] });
    expect(await h.ok("recovery.dismiss", { opIds: ["a", "unknown"] })).toBe(1);
    expect(pending(h)).toBeUndefined();
  });

  it("system.purgeCorrupt defaults to every corrupt:* key and accepts import:failed", async () => {
    const h = await setup();
    const rec = { key: "x", raw: 1, error: "bad", at: 1 };
    h.fake.local.set("corrupt:ws:meta:x", rec);
    h.fake.local.set("corrupt:settings", rec);
    h.fake.local.set("import:failed", { reason: "r", error: "e", at: 1 });

    expect(await h.ok("system.purgeCorrupt", {})).toBe(2);
    expect(stored(h.fake, "corrupt:ws:meta:x")).toBeUndefined();
    expect(stored(h.fake, "corrupt:settings")).toBeUndefined();
    expect(stored(h.fake, "import:failed")).toBeDefined();
    expect(await h.ok("system.purgeCorrupt", {})).toBe(0);

    expect(await h.ok("system.purgeCorrupt", { keys: ["import:failed"] })).toBe(1);
    expect(stored(h.fake, "import:failed")).toBeUndefined();
  });

  it("system.purgeCorrupt rejects keys outside the allowed families", async () => {
    const h = await setup({ before: (f) => seedWorkspace(f, "A", []) });
    for (const keys of [["ws:meta:A"], ["corrupt:x", "settings"], ["ws:index"]]) {
      expect(await h.rpc("system.purgeCorrupt", { keys })).toMatchObject({ code: "invalid" });
    }
    expect(stored(h.fake, Keys.wsMeta("A"))).toBeDefined();
  });
});

describe("system.onboarded", () => {
  it("stamps meta.onboardedAt and keeps the other meta fields", async () => {
    const h = await setup();
    const before = stored<Meta>(h.fake, Keys.meta);
    expect(before?.onboardedAt).toBeUndefined();
    expect(await h.ok("system.onboarded", {})).toBeNull();
    const after = stored<Meta>(h.fake, Keys.meta);
    expect(after).toEqual({ ...before, onboardedAt: h.fake.clock });
    h.fake.clock += 5_000;
    await h.ok("system.onboarded", {});
    expect(stored<Meta>(h.fake, Keys.meta)?.onboardedAt).toBe(h.fake.clock);
  });

  it("tolerates a missing meta (nothing is written)", async () => {
    const h = await setup();
    h.fake.local.delete(Keys.meta);
    expect(await h.ok("system.onboarded", {})).toBeNull();
    expect(stored(h.fake, Keys.meta)).toBeUndefined();
  });
});
