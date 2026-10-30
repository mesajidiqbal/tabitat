import { describe, expect, it } from "vitest";
import { SchemaError } from "../model/schemas";
import type { BackupFile, SavedLink } from "../model/types";
import { DEFAULT_SETTINGS, Keys } from "../model/types";
import { NOW, savedTab, seqIds, workspaceMeta, workspaceTabs } from "../testing/fixtures";
import { buildBackup, checkBackupLimits, IMPORT_LIMITS, planImport, validateBackup } from "./index";

const link: SavedLink = { id: "l", url: "https://l.com", title: "L", order: 0, addedAt: NOW };

function storage(): Record<string, unknown> {
  return {
    meta: { schemaVersion: 1, installedAt: 1, flavor: "default" },
    settings: { theme: "dark", rev: 4 },
    "ws:index": ["A", "B", "missing"],
    "ws:meta:A": workspaceMeta("A", { name: "Alpha", windowHint: 12 }),
    "ws:tabs:A": workspaceTabs([savedTab({ id: "a1" })], { activeSavedTabId: "a1", rev: 3 }),
    "ws:meta:B": workspaceMeta("B", {
      name: "Beta",
      resources: [link, { ...link, id: "bad", url: "javascript:x" }],
    }),
    "ws:tabs:B": {
      tabs: [savedTab({ id: "b1" }), savedTab({ id: "b2", url: "data:x" })],
      activeSavedTabId: "b2",
      updatedAt: 5,
      rev: 2,
    },
    "ws:meta:C": workspaceMeta("C", { name: "Unindexed", kind: "unsorted" }),
    "ws:meta:D": { id: "other-id" },
    "ws:meta:E": { id: "E", nonsense: true },
    "todos:global": {
      items: [{ id: "t1", text: "x", done: false, order: 0, createdAt: 1 }],
      rev: 2,
    },
    "todos:A": { items: [], rev: 0 },
    "todos:bad": { nope: 1 },
    "notes:global": { content: "global note", updatedAt: 1, rev: 1 },
    "notes:A": { content: "alpha note", updatedAt: 1, rev: 1 },
    quicklinks: {
      items: [
        { id: "q1", url: "https://q.com", title: "Q", order: 0 },
        { id: "q2", url: "javascript:x", title: "Bad", order: 1 },
      ],
      rev: 6,
    },
    "windows:1": { activeWorkspaceId: "A", sessionEpoch: "e" },
    trash: { items: [] },
  };
}

describe("buildBackup", () => {
  it("collects records, salvages what it can and validates", () => {
    const file = buildBackup(storage(), NOW);
    expect(validateBackup(file)).toEqual(file);
    expect(file.format).toBe("tabitat-backup");
    expect(file.exportedAt).toBe(NOW);
    expect(file.data.settings).toEqual({ ...DEFAULT_SETTINGS, theme: "dark", rev: 4 });
    expect(file.data.workspaces.map((w) => w.meta.id)).toEqual(["A", "B", "C"]);
    const b = file.data.workspaces[1];
    expect(b?.meta.resources.map((r) => r.id)).toEqual(["l"]);
    expect(b?.tabs).toEqual({ tabs: [savedTab({ id: "b1" })], updatedAt: 5, rev: 2 });
    expect(file.data.workspaces[2]?.tabs).toEqual({ tabs: [], updatedAt: NOW - 1000, rev: 0 });
    expect(Object.keys(file.data.todos)).toEqual(["global", "A"]);
    expect(Object.keys(file.data.notes)).toEqual(["global", "A"]);
    expect(file.data.quicklinks).toEqual({
      items: [{ id: "q1", url: "https://q.com", title: "Q", order: 0 }],
      rev: 6,
    });
  });

  it("works on empty or garbage storage", () => {
    const file = buildBackup({ settings: { theme: "neon" }, "ws:index": "x", quicklinks: 5 }, NOW);
    expect(file.data).toEqual({
      settings: DEFAULT_SETTINGS,
      workspaces: [],
      todos: {},
      notes: {},
      quicklinks: { items: [], rev: 0 },
    });
    expect(buildBackup({}, NOW).data.settings).toEqual(DEFAULT_SETTINGS);
  });

  it("keeps a valid activeSavedTabId when salvaging tabs", () => {
    const file = buildBackup(
      {
        "ws:index": ["A"],
        "ws:meta:A": workspaceMeta("A"),
        "ws:tabs:A": {
          tabs: [savedTab({ id: "a1" }), { bad: 1 }],
          activeSavedTabId: "a1",
          rev: -1,
        },
      },
      NOW,
    );
    expect(file.data.workspaces[0]?.tabs).toEqual({
      tabs: [savedTab({ id: "a1" })],
      activeSavedTabId: "a1",
      updatedAt: NOW - 1000,
      rev: 0,
    });
  });
});

describe("validateBackup", () => {
  it("an older export's oversized whitelist is cut instead of rejecting the file", () => {
    const file = structuredClone(buildBackup(storage(), NOW)) as BackupFile;
    const whitelist = Array.from({ length: 230 }, (_, i) => `h${i}.example`);
    file.data.settings.suspend.whitelist = whitelist;
    expect(validateBackup(file).data.settings.suspend.whitelist).toEqual(whitelist.slice(0, 200));
    const raw = storage();
    raw[Keys.settings] = { ...(raw[Keys.settings] as object), suspend: { whitelist } };
    expect(buildBackup(raw, NOW).data.settings.suspend.whitelist).toHaveLength(200);
  });
  it("rejects dangerous URLs with a SchemaError path", () => {
    const file = buildBackup(storage(), NOW) as BackupFile;
    const bad = structuredClone(file);
    (bad.data.workspaces[0]?.tabs.tabs[0] as { url: string }).url = "javascript:alert(1)";
    expect(() => validateBackup(bad)).toThrow(SchemaError);
    try {
      validateBackup(bad);
    } catch (e) {
      expect((e as SchemaError).path).toBe("data.workspaces.0.tabs.tabs.0.url");
    }
    expect(() => validateBackup({})).toThrow(SchemaError);
  });

  it("rejects duplicate saved-tab ids and ids outside the id pattern (bug 6)", () => {
    const file = buildBackup(storage(), NOW) as BackupFile;
    const dup = structuredClone(file);
    const ws0 = dup.data.workspaces[0];
    if (!ws0) throw new Error("fixture");
    ws0.tabs.tabs.push({ ...savedTab({ id: "a1" }), url: "https://second.example/", index: 1 });
    expect(() => validateBackup(dup)).toThrow(/unique/);
    const proto = structuredClone(file);
    (proto.data.workspaces[0]?.tabs.tabs[0] as { id: string }).id = "__proto__";
    expect(() => validateBackup(proto)).toThrow(SchemaError);
    const spaced = structuredClone(file);
    (spaced.data.workspaces[0]?.meta as { id: string }).id = "a b";
    expect(() => validateBackup(spaced)).toThrow(SchemaError);
  });

  it("drops a dangling activeSavedTabId instead of rejecting the file (U)", () => {
    const file = buildBackup(storage(), NOW) as BackupFile;
    const t = file.data.workspaces[0]?.tabs;
    if (t) t.activeSavedTabId = "missing";
    expect(validateBackup(file).data.workspaces[0]?.tabs.activeSavedTabId).toBeUndefined();
  });

  it("drops disallowed favicons instead of rejecting the file", () => {
    const file = buildBackup(storage(), NOW) as BackupFile;
    const t0 = file.data.workspaces[0]?.tabs.tabs[0];
    if (t0) t0.favIconUrl = "blob:https://a/x";
    const out = validateBackup(file);
    expect(out.data.workspaces[0]?.tabs.tabs[0]?.favIconUrl).toBeUndefined();
  });
});

describe("checkBackupLimits", () => {
  const ws = (tabs: number) => ({ tabs: { tabs: Array.from({ length: tabs }, () => ({})) } });
  it("accepts files within bounds", () => {
    expect(checkBackupLimits({ data: { workspaces: [ws(3)] } }, 10)).toBeNull();
    expect(checkBackupLimits("garbage", 10)).toBeNull();
  });
  it("rejects size, workspace count and tab count over the limits", () => {
    expect(checkBackupLimits({}, IMPORT_LIMITS.maxBytes + 1)).toMatch(/MB/);
    const many = { data: { workspaces: Array.from({ length: 1001 }, () => ws(0)) } };
    expect(checkBackupLimits(many, 10)).toMatch(/workspaces/);
    const big = { data: { workspaces: [ws(15_000), ws(5_001)] } };
    expect(checkBackupLimits(big, 10)).toMatch(/tabs/);
  });
});

function fileWith(over: Partial<BackupFile["data"]> = {}): BackupFile {
  return {
    format: "tabitat-backup",
    version: 1,
    exportedAt: NOW,
    data: {
      settings: { ...DEFAULT_SETTINGS, theme: "light", rev: 1 },
      workspaces: [
        {
          meta: workspaceMeta("A", { name: "Alpha", windowHint: 99, rev: 2 }),
          tabs: workspaceTabs([savedTab({ id: "x1" })], { rev: 1 }),
        },
        {
          meta: workspaceMeta("N", { name: "New", kind: "unsorted" }),
          tabs: workspaceTabs([], { rev: 1 }),
        },
      ],
      todos: {
        global: {
          items: [{ id: "t1", text: "imported", done: false, order: 0, createdAt: 1 }],
          rev: 1,
        },
        A: { items: [{ id: "ta", text: "alpha", done: false, order: 0, createdAt: 1 }], rev: 1 },
        ghost: { items: [], rev: 0 },
      },
      notes: {
        global: { content: "imported note", updatedAt: 9, rev: 1 },
        A: { content: "alpha note", updatedAt: 1, rev: 1 },
        ghost: { content: "?", updatedAt: 1, rev: 1 },
      },
      quicklinks: {
        items: [
          { id: "q1", url: "https://q.com/", title: "Q dup", order: 0 },
          { id: "q9", url: "https://new.com", title: "New", order: 1 },
          { id: "q10", url: "https://new.com/#x", title: "New dup", order: 2 },
        ],
        rev: 1,
      },
      ...over,
    },
  };
}

describe("planImport — replace", () => {
  it("removes existing ws/todos/notes keys and writes the file", () => {
    const existing = storage();
    const plan = planImport(fileWith(), existing, "replace", { newId: seqIds("n") });
    expect(plan.remove.sort()).toEqual(
      ["ws:meta:B", "ws:tabs:B", "ws:meta:C", "ws:meta:D", "ws:meta:E", "todos:bad"].sort(),
    );
    for (const k of plan.remove) expect(plan.set).not.toHaveProperty(k);
    expect(plan.set["ws:index"]).toEqual(["A", "N"]);
    const metaA = plan.set["ws:meta:A"] as Record<string, unknown>;
    expect(metaA).not.toHaveProperty("windowHint");
    expect(metaA.rev).toBe(3); // max(existing 1, imported 2) + 1
    expect((plan.set["ws:meta:N"] as { kind: string }).kind).toBe("named");
    expect((plan.set["ws:meta:N"] as { rev: number }).rev).toBe(1); // no existing record
    expect((plan.set["ws:tabs:A"] as { rev: number }).rev).toBe(4);
    expect(plan.set["todos:global"]).toEqual({ ...fileWith().data.todos.global, rev: 3 });
    expect(plan.set["notes:global"]).toEqual({ content: "imported note", updatedAt: 9, rev: 2 });
    expect(plan.set.quicklinks).toEqual({ ...fileWith().data.quicklinks, rev: 7 });
    expect(plan.set.settings).toEqual({ ...DEFAULT_SETTINGS, theme: "light", rev: 5 });
    expect(plan.set).not.toHaveProperty("todos:ghost");
    expect(plan.report).toEqual({
      workspaces: 2,
      todos: 2,
      notes: 2,
      quicklinks: 3,
      warnings: [
        'todos for unknown workspace "ghost" skipped',
        'note for unknown workspace "ghost" skipped',
      ],
    });
  });

  it("gives duplicate ids inside the file new ids", () => {
    const f = fileWith();
    f.data.workspaces.push({ ...(f.data.workspaces[0] as BackupFile["data"]["workspaces"][0]) });
    const plan = planImport(f, {}, "replace", { newId: seqIds("n") });
    expect(plan.set["ws:index"]).toEqual(["A", "N", "n-1"]);
    expect(plan.report.warnings[0]).toMatch(/duplicate workspace id "A"/);
    expect(plan.remove).toEqual([]);
  });
});

describe("planImport — merge", () => {
  it("keeps existing data and adds imported workspaces with fresh ids", () => {
    const existing = storage();
    const plan = planImport(fileWith(), existing, "merge", { newId: seqIds("n"), now: NOW });
    expect(plan.remove).toEqual([]);
    expect(plan.set["ws:index"]).toEqual(["A", "B", "missing", "C", "D", "E", "n-1", "N"]);
    expect(plan.set).not.toHaveProperty("ws:meta:A");
    expect(plan.set["ws:meta:n-1"]).toMatchObject({ id: "n-1", name: "Alpha (imported)", rev: 2 });
    expect(plan.set["ws:meta:N"]).toMatchObject({ id: "N", name: "New", kind: "named" });
    // workspace-scoped records follow the new id
    expect(plan.set["todos:n-1"]).toEqual(fileWith().data.todos.A);
    expect(plan.set["notes:n-1"]).toEqual(fileWith().data.notes.A);
    expect(plan.set).not.toHaveProperty("settings");
    expect(plan.report.warnings).toContain("settings are not imported in merge mode");
    expect(plan.report.warnings).toContain(
      'workspace "Alpha" already exists; imported as "Alpha (imported)"',
    );
  });

  it("appends todos with fresh ids and orders", () => {
    const existing = storage();
    existing["todos:global"] = {
      items: [{ id: "t1", text: "mine", done: false, order: 4, createdAt: 1 }],
      rev: 2,
    };
    const plan = planImport(fileWith(), existing, "merge", { newId: seqIds("n") });
    expect(plan.set["todos:global"]).toEqual({
      items: [
        { id: "t1", text: "mine", done: false, order: 4, createdAt: 1 },
        { id: "n-2", text: "imported", done: false, order: 5, createdAt: 1 },
      ],
      rev: 3,
    });
    expect(plan.report.todos).toBe(2);
  });

  it("concatenates differing notes, skips identical or empty ones", () => {
    const plan = planImport(fileWith(), storage(), "merge", { newId: seqIds("n"), now: NOW });
    expect(plan.set["notes:global"]).toEqual({
      content: "global note\n\nimported note",
      updatedAt: NOW,
      rev: 2,
    });
    const same = planImport(
      fileWith({ notes: { global: { content: "global note", updatedAt: 1, rev: 1 } } }),
      storage(),
      "merge",
    );
    expect(same.set).not.toHaveProperty("notes:global");
    const empty = planImport(
      fileWith({ notes: { global: { content: "  ", updatedAt: 1, rev: 1 } } }),
      storage(),
      "merge",
    );
    expect(empty.set).not.toHaveProperty("notes:global");
    expect(empty.report.notes).toBe(0);
    const noNow = planImport(fileWith(), storage(), "merge", { newId: seqIds("n") });
    expect((noNow.set["notes:global"] as { updatedAt: number }).updatedAt).toBe(9);
  });

  it("adds only new quicklinks (and drops invalid existing ones)", () => {
    const plan = planImport(fileWith(), storage(), "merge", { newId: seqIds("n") });
    expect(plan.set.quicklinks).toEqual({
      items: [
        { id: "q1", url: "https://q.com", title: "Q", order: 0 },
        { id: "q9", url: "https://new.com", title: "New", order: 1 },
      ],
      rev: 7,
    });
    expect(plan.report.quicklinks).toBe(1);
  });

  it("writes nothing for quicklinks when nothing is new; uses the file when none exist", () => {
    const f = fileWith({
      quicklinks: { items: [{ id: "z", url: "https://q.com", title: "", order: 0 }], rev: 0 },
    });
    const existing = storage();
    existing.quicklinks = {
      items: [{ id: "z", url: "https://q.com", title: "", order: 0 }],
      rev: 0,
    };
    expect(planImport(f, existing, "merge").set).not.toHaveProperty("quicklinks");
    const plan = planImport(f, {}, "merge");
    expect(plan.set.quicklinks).toEqual(f.data.quicklinks);
    expect(plan.set["ws:index"]).toEqual(["A", "N"]);
  });

  it("collision ids keep drawing until free", () => {
    const ids = ["A", "B", "fresh"];
    const plan = planImport(fileWith(), storage(), "merge", { newId: () => ids.shift() ?? "x" });
    expect(plan.set["ws:index"]).toEqual(["A", "B", "missing", "C", "D", "E", "fresh", "N"]);
  });

  it("defaults newId to uuids", () => {
    const plan = planImport(fileWith(), storage(), "merge");
    const idx = plan.set["ws:index"] as string[];
    expect(idx[6]).toMatch(/^[0-9a-f-]{36}$/);
  });
});
