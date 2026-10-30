import type * as v from "valibot";
import { describe, expect, expectTypeOf, it } from "vitest";
import { NOW, savedTab, workspaceMeta, workspaceTabs } from "../testing/fixtures";
import * as S from "./schemas";
import type {
  BackupFile,
  ClosedTab,
  Meta,
  Note,
  PomodoroState,
  QuickLinks,
  SavedLink,
  SavedTab,
  SavedTabGroup,
  SessionGeneration,
  Settings,
  SwitchOp,
  TodoList,
  Trash,
  WindowState,
  WorkspaceMeta,
  WorkspaceTabs,
} from "./types";
import { DEFAULT_SETTINGS } from "./types";

describe("schema output types match types.ts", () => {
  it("compiles", () => {
    expectTypeOf<v.InferOutput<typeof S.SavedTabGroupSchema>>().toEqualTypeOf<SavedTabGroup>();
    expectTypeOf<v.InferOutput<typeof S.SavedTabSchema>>().toEqualTypeOf<SavedTab>();
    expectTypeOf<v.InferOutput<typeof S.SavedLinkSchema>>().toEqualTypeOf<SavedLink>();
    expectTypeOf<v.InferOutput<typeof S.WorkspaceMetaSchema>>().toEqualTypeOf<WorkspaceMeta>();
    expectTypeOf<v.InferOutput<typeof S.WorkspaceTabsSchema>>().toEqualTypeOf<WorkspaceTabs>();
    expectTypeOf<v.InferOutput<typeof S.WindowStateSchema>>().toEqualTypeOf<WindowState>();
    expectTypeOf<v.InferOutput<typeof S.SwitchOpSchema>>().toEqualTypeOf<SwitchOp>();
    expectTypeOf<
      v.InferOutput<typeof S.SessionGenerationSchema>
    >().toEqualTypeOf<SessionGeneration>();
    expectTypeOf<v.InferOutput<typeof S.ClosedTabSchema>>().toEqualTypeOf<ClosedTab>();
    expectTypeOf<v.InferOutput<typeof S.TodoListSchema>>().toEqualTypeOf<TodoList>();
    expectTypeOf<v.InferOutput<typeof S.NoteSchema>>().toEqualTypeOf<Note>();
    expectTypeOf<v.InferOutput<typeof S.QuickLinksSchema>>().toEqualTypeOf<QuickLinks>();
    expectTypeOf<v.InferOutput<typeof S.TrashSchema>>().toEqualTypeOf<Trash>();
    expectTypeOf<v.InferOutput<typeof S.SettingsSchema>>().toEqualTypeOf<Settings>();
    expectTypeOf<v.InferOutput<typeof S.PomodoroStateSchema>>().toEqualTypeOf<PomodoroState>();
    expectTypeOf<v.InferOutput<typeof S.MetaSchema>>().toEqualTypeOf<Meta>();
    expectTypeOf<v.InferOutput<typeof S.BackupFileSchema>>().toEqualTypeOf<BackupFile>();
  });
});

const tab = savedTab({ id: "t1", group: { id: "g", title: "G", color: "red", collapsed: false } });
const link: SavedLink = { id: "l1", url: "https://a.com", title: "A", order: 0, addedAt: NOW };
const meta = workspaceMeta("w1", { resources: [link], emoji: "🚀", windowHint: 3 });
const tabs = workspaceTabs([tab], { activeSavedTabId: "t1" });
const op: SwitchOp = {
  id: "op",
  windowId: 1,
  from: null,
  to: "w1",
  stage: "opening",
  sessionEpoch: "e",
  outgoingTabIds: [1, 2],
  createdTabIds: { t1: 9 },
  incoming: [tab],
  skipped: [savedTab({ id: "x", url: "chrome-extension://abc/x.html" })],
  startedAt: NOW,
  attempts: 0,
};
const backup: BackupFile = {
  format: "tabitat-backup",
  version: 1,
  exportedAt: NOW,
  data: {
    settings: structuredClone(DEFAULT_SETTINGS),
    workspaces: [{ meta, tabs }],
    todos: { global: { items: [], rev: 0 } },
    notes: { w1: { content: "hi", updatedAt: NOW, rev: 2 } },
    quicklinks: { items: [{ id: "q", url: "https://q.com", title: "Q", order: 0 }], rev: 1 },
  },
};

const valid: Array<[string, (x: unknown) => unknown, (x: unknown) => boolean, unknown]> = [
  ["SavedTabGroup", S.parseSavedTabGroup, S.isSavedTabGroup, tab.group],
  ["SavedTab", S.parseSavedTab, S.isSavedTab, tab],
  ["SavedLink", S.parseSavedLink, S.isSavedLink, link],
  ["WorkspaceMeta", S.parseWorkspaceMeta, S.isWorkspaceMeta, meta],
  ["WorkspaceTabs", S.parseWorkspaceTabs, S.isWorkspaceTabs, tabs],
  [
    "WindowState",
    S.parseWindowState,
    S.isWindowState,
    { activeWorkspaceId: null, sessionEpoch: "e" },
  ],
  ["SwitchOp", S.parseSwitchOp, S.isSwitchOp, op],
  [
    "SessionGeneration",
    S.parseSessionGeneration,
    S.isSessionGeneration,
    { id: 3, takenAt: NOW, windows: [{ windowId: 1, workspaceId: "w1", tabs: [tab] }] },
  ],
  [
    "ClosedTab",
    S.parseClosedTab,
    S.isClosedTab,
    { id: "c", url: "chrome-extension://x/y", title: "", closedAt: NOW, workspaceId: "w1" },
  ],
  [
    "TodoList",
    S.parseTodoList,
    S.isTodoList,
    {
      items: [{ id: "a", text: "x", done: true, order: 0, createdAt: NOW, doneAt: NOW }],
      rev: 1,
    },
  ],
  ["Note", S.parseNote, S.isNote, { content: "", updatedAt: NOW, rev: 0 }],
  ["QuickLinks", S.parseQuickLinks, S.isQuickLinks, backup.data.quicklinks],
  [
    "Trash",
    S.parseTrash,
    S.isTrash,
    {
      items: [
        { id: "1", kind: "workspace", deletedAt: NOW, meta, tabs },
        { id: "2", kind: "link", deletedAt: NOW, workspaceId: "w1", link },
      ],
    },
  ],
  ["Settings", S.parseSettings, S.isSettings, DEFAULT_SETTINGS],
  [
    "PomodoroState",
    S.parsePomodoroState,
    S.isPomodoroState,
    { phase: "work", endsAt: NOW, round: 1 },
  ],
  ["Meta", S.parseMeta, S.isMeta, { schemaVersion: 1, installedAt: NOW, flavor: "newtab" }],
  ["BackupFile", S.parseBackupFile, S.isBackupFile, backup],
];

describe.each(valid)("%s", (_name, parse, is, value) => {
  it("parses a valid value to an equal value", () => {
    expect(parse(value)).toEqual(value);
    expect(is(value)).toBe(true);
  });
  it("rejects non-objects with SchemaError", () => {
    expect(() => parse(42)).toThrow(S.SchemaError);
    expect(is(null)).toBe(false);
  });
});

describe("SchemaError", () => {
  it("reports the dot path of the failing field", () => {
    try {
      S.parseWorkspaceTabs({ ...tabs, tabs: [tab, { ...tab, url: "javascript:alert(1)" }] });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(S.SchemaError);
      const err = e as S.SchemaError;
      expect(err.path).toBe("tabs.1.url");
      expect(err.schema).toBe("WorkspaceTabs");
      expect(err.message).toMatch(/^WorkspaceTabs\.tabs\.1\.url: /);
      expect(err.issues.length).toBeGreaterThan(0);
    }
  });
  it("uses an empty path for root errors", () => {
    try {
      S.parseNote("nope");
      expect.unreachable();
    } catch (e) {
      expect((e as S.SchemaError).path).toBe("");
      expect((e as S.SchemaError).message).toMatch(/^Note: /);
    }
  });
});

describe("URL policy", () => {
  const bad = [
    "javascript:alert(1)",
    "data:text/html,x",
    "vbscript:x",
    "blob:https://a.com/x",
    "filesystem:https://a.com/x",
  ];
  const good = [
    "https://a.com",
    "http://a.com",
    "file:///a",
    "ftp://a.com",
    "chrome://settings",
    "edge://flags",
    "brave://x",
    "about:blank",
    "vivaldi://x",
    "opera://x",
    "chrome-extension://a/b",
  ];
  it.each(good)("accepts %s", (url) => {
    expect(S.isSavedTab({ ...tab, url })).toBe(true);
    expect(S.isSavedLink({ ...link, url })).toBe(true);
    expect(S.isQuickLink({ id: "q", url, title: "", order: 0 })).toBe(true);
  });
  it.each(bad)("rejects %s", (url) => {
    expect(S.isSavedTab({ ...tab, url })).toBe(false);
    expect(S.isSavedLink({ ...link, url })).toBe(false);
    expect(S.isQuickLink({ id: "q", url, title: "", order: 0 })).toBe(false);
  });
  it("ClosedTab uses the same restorable-scheme policy as SavedTab", () => {
    for (const url of bad) {
      expect(S.isClosedTab({ id: "c", url, title: "", closedAt: NOW })).toBe(false);
    }
    expect(S.isClosedTab({ id: "c", url: "https://a.com", title: "", closedAt: NOW })).toBe(true);
  });
  it("favicons use the snapshot allowlist (no data:/blob:)", () => {
    for (const favIconUrl of ["data:image/png;base64,AA", "blob:https://a/x", "javascript:x"]) {
      expect(S.isSavedTab({ ...tab, favIconUrl })).toBe(false);
      expect(
        S.isClosedTab({ id: "c", url: "https://a", title: "", closedAt: NOW, favIconUrl }),
      ).toBe(false);
    }
    expect(S.isSavedTab({ ...tab, favIconUrl: "chrome://favicon/x" })).toBe(true);
  });
});

describe("ids", () => {
  it.each(["", "a b", "x/y", "é", "a".repeat(65), "__proto__"])("rejects id %j", (id) => {
    expect(S.isSavedTab({ ...tab, id })).toBe(false);
    expect(S.isWorkspaceMeta({ ...meta, id })).toBe(false);
    expect(() => S.parseWorkspaceIndex([id])).toThrow(S.SchemaError);
  });
  it.each(["a", "A-b_9", "constructor", "a".repeat(64)])("accepts id %j", (id) => {
    expect(S.isSavedTab({ ...tab, id })).toBe(true);
  });
  it("activeSavedTabId must reference one of the tabs (U)", () => {
    expect(S.isWorkspaceTabs({ ...tabs, activeSavedTabId: "nope" })).toBe(false);
    expect(S.isWorkspaceTabs({ ...tabs, activeSavedTabId: "t1" })).toBe(true);
    const { activeSavedTabId: _a, ...noActive } = tabs;
    expect(S.isWorkspaceTabs(noActive)).toBe(true);
  });
  it("saved tab ids are unique within a workspace", () => {
    const t2 = { ...tab, url: "https://other.example/" };
    expect(S.isWorkspaceTabs({ ...tabs, tabs: [tab, t2] })).toBe(false);
    expect(S.isWorkspaceTabs({ ...tabs, tabs: [tab, { ...t2, id: "t2" }] })).toBe(true);
  });
  it("link ids are unique within a workspace, index ids unique", () => {
    expect(S.isWorkspaceMeta({ ...meta, resources: [link, { ...link, url: "https://b" }] })).toBe(
      false,
    );
    expect(() => S.parseWorkspaceIndex(["a", "b", "a"])).toThrow(/unique/);
  });
  it("op incoming ids are unique; outgoingSavedIds keys are tab ids", () => {
    expect(S.isSwitchOp({ ...op, incoming: [tab, tab] })).toBe(false);
    expect(S.parseSwitchOp({ ...op, outgoingSavedIds: { 1: "t1" } }).outgoingSavedIds).toEqual({
      1: "t1",
    });
    expect(S.isSwitchOp({ ...op, outgoingSavedIds: { x: "t1" } })).toBe(false);
  });
  it("SwitchOp keeps unrestorable tabs in skipped", () => {
    expect(S.parseSwitchOp(op).skipped[0]?.url).toBe("chrome-extension://abc/x.html");
  });
});

describe("Settings defaults", () => {
  it("fills every missing field from DEFAULT_SETTINGS", () => {
    expect(S.parseSettings({})).toEqual(DEFAULT_SETTINGS);
    expect(S.parseSettings(undefined)).toEqual(DEFAULT_SETTINGS);
  });
  it("fills nested missing fields and keeps present ones", () => {
    const s = S.parseSettings({
      theme: "dark",
      suspend: { enabled: true },
      dashboard: { wallpaper: { kind: "color" } },
      rev: 7,
    });
    expect(s.theme).toBe("dark");
    expect(s.suspend).toEqual({ ...DEFAULT_SETTINGS.suspend, enabled: true });
    expect(s.dashboard.widgets).toEqual(DEFAULT_SETTINGS.dashboard.widgets);
    expect(s.dashboard.wallpaper).toEqual({ kind: "color", value: "aurora" });
    expect(s.pomodoro).toEqual(DEFAULT_SETTINGS.pomodoro);
    expect(s.rev).toBe(7);
  });
  it("returns fresh default objects (no shared mutable state)", () => {
    const a = S.parseSettings({});
    a.suspend.whitelist.push("x.com");
    a.dashboard.widgets.pop();
    expect(S.parseSettings({}).suspend.whitelist).toEqual([]);
    expect(DEFAULT_SETTINGS.suspend.whitelist).toEqual([]);
    expect(DEFAULT_SETTINGS.dashboard.widgets).toHaveLength(5);
  });
  it("strips unknown keys", () => {
    expect(S.parseSettings({ legacy: true })).not.toHaveProperty("legacy");
  });
  it("rejects invalid present values", () => {
    expect(() => S.parseSettings({ theme: "neon" })).toThrow(S.SchemaError);
    expect(() => S.parseSettings({ restoreLimit: 0 })).toThrow(/restoreLimit/);
    expect(() => S.parseSettings({ dashboard: { widgets: ["nope"] } })).toThrow(
      /dashboard\.widgets\.0/,
    );
  });
  it("isSettings requires a complete object", () => {
    expect(S.isSettings({})).toBe(false);
    expect(S.isSettings({ ...DEFAULT_SETTINGS, suspend: { enabled: true } })).toBe(false);
    expect(S.isSettings(structuredClone(DEFAULT_SETTINGS))).toBe(true);
  });
});

describe("BackupFile defaults", () => {
  it("fills optional data sections", () => {
    const f = S.parseBackupFile({
      format: "tabitat-backup",
      version: 1,
      exportedAt: NOW,
      data: { workspaces: [] },
    });
    expect(f.data.settings).toEqual(DEFAULT_SETTINGS);
    expect(f.data.todos).toEqual({});
    expect(f.data.notes).toEqual({});
    expect(f.data.quicklinks).toEqual({ items: [], rev: 0 });
  });
  it("rejects wrong format/version", () => {
    expect(() => S.parseBackupFile({ ...backup, format: "other" })).toThrow(/format/);
    expect(() => S.parseBackupFile({ ...backup, version: 2 })).toThrow(/version/);
  });
});

describe("SessionsIndex", () => {
  it("accepts ascending generation ids", () => {
    expect(S.parseSessionsIndex([])).toEqual([]);
    expect(S.parseSessionsIndex([1, 2, 7])).toEqual([1, 2, 7]);
    expect(S.isSessionsIndex([0, 3])).toBe(true);
  });
  it("rejects strings, non-integers, negatives and unsorted/duplicate ids", () => {
    expect(() => S.parseSessionsIndex(["1"])).toThrow(S.SchemaError);
    expect(() => S.parseSessionsIndex([1.5])).toThrow(/SessionsIndex\.0/);
    expect(S.isSessionsIndex([-1])).toBe(false);
    expect(() => S.parseSessionsIndex([3, 2])).toThrow(/ascending/);
    expect(S.isSessionsIndex([2, 2])).toBe(false);
    expect(S.isSessionsIndex({})).toBe(false);
  });
});

describe("misc schemas", () => {
  it("WorkspaceIndex / RecentlyClosed", () => {
    expect(S.parseWorkspaceIndex(["a", "b"])).toEqual(["a", "b"]);
    expect(() => S.parseWorkspaceIndex(["a", ""])).toThrow(S.SchemaError);
    expect(S.parseRecentlyClosed([])).toEqual([]);
  });
  it("isTodo", () => {
    expect(S.isTodo({ id: "a", text: "", done: false, order: 0, createdAt: NOW })).toBe(true);
    expect(S.isTodo({ id: "a" })).toBe(false);
  });
  it("rejects NaN numbers and negative revs", () => {
    expect(S.isNote({ content: "", updatedAt: Number.NaN, rev: 0 })).toBe(false);
    expect(S.isNote({ content: "", updatedAt: NOW, rev: -1 })).toBe(false);
  });
});
