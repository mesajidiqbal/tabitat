/**
 * valibot schemas for every persisted record (ARCHITECTURE §6). Output types match types.ts
 * exactly (checked in schemas.test.ts). Unknown object keys are stripped on parse.
 */
import * as v from "valibot";
import { isAllowedFavIconUrl, isRestorableUrl } from "../ops/url";
import { hasUniqueIds, isValidId } from "./id";
import type {
  BackupFile,
  ClosedTab,
  Meta,
  Note,
  PomodoroState,
  QuickLink,
  QuickLinks,
  SavedLink,
  SavedTab,
  SavedTabGroup,
  SessionGeneration,
  Settings,
  SwitchOp,
  Todo,
  TodoList,
  Trash,
  TrashItem,
  WindowState,
  WorkspaceMeta,
  WorkspacePrev,
  WorkspaceTabs,
} from "./types";
import { DEFAULT_SETTINGS, LIMITS } from "./types";

/** Thrown by every parseX helper; `path` is the dot path of the first failing field ("" = root). */
export class SchemaError extends Error {
  override readonly name = "SchemaError";
  constructor(
    readonly schema: string,
    readonly path: string,
    readonly issues: readonly string[],
  ) {
    super(`${schema}${path ? `.${path}` : ""}: ${issues[0] ?? "invalid"}`);
  }
}

// ---------------------------------------------------------------- primitives

/** Record ids: `^[A-Za-z0-9_-]{1,64}$` and never a reserved name (see model/id.ts). */
export const IdSchema = v.pipe(
  v.string(),
  v.minLength(1, "must be a non-empty string"),
  v.check((id: string) => isValidId(id), "must match ^[A-Za-z0-9_-]{1,64}$ and not be reserved"),
);
const Id = IdSchema;
const Int = v.pipe(v.number(), v.integer());
const NonNegInt = v.pipe(v.number(), v.integer(), v.minValue(0));
const PosInt = v.pipe(v.number(), v.integer(), v.minValue(1));
const Timestamp = v.pipe(v.number(), v.finite());

/** http(s)/file/ftp or a browser-internal scheme (chrome:, edge:, brave:, about:, vivaldi:, opera:). */
export const RestorableUrlSchema = v.pipe(
  v.string(),
  v.check(isRestorableUrl, "URL scheme is not allowed"),
);
/**
 * Favicon URLs: the same allowlist snapshot sanitising uses (core/ops/url.ts
 * isAllowedFavIconUrl), so a sanitised snapshot always validates and an import cannot smuggle in
 * a scheme the snapshot would have dropped.
 */
export const FavIconUrlSchema = v.pipe(
  v.string(),
  v.check((u: string) => isAllowedFavIconUrl(u), "favicon URL scheme is not allowed"),
);

export const ColorSchema = v.picklist([
  "grey",
  "blue",
  "red",
  "yellow",
  "green",
  "pink",
  "purple",
  "cyan",
  "orange",
]);

export const WidgetIdSchema = v.picklist([
  "clock",
  "search",
  "quicklinks",
  "workspaces",
  "todos",
  "notes",
  "pomodoro",
]);

// ---------------------------------------------------------------- workspaces

export const SavedTabGroupSchema = v.object({
  id: Id,
  title: v.string(),
  color: ColorSchema,
  collapsed: v.boolean(),
});

const savedTabEntries = {
  id: Id,
  url: RestorableUrlSchema,
  title: v.string(),
  index: NonNegInt,
  favIconUrl: v.optional(FavIconUrlSchema),
  group: v.optional(SavedTabGroupSchema),
};

export const SavedTabSchema = v.object(savedTabEntries);

/**
 * SavedTab without the URL policy. Used only inside SwitchOp (incoming/skipped), which is
 * produced by the planner and may legitimately list tabs it refused to restore.
 */
const OpSavedTabSchema = v.object({ ...savedTabEntries, url: v.string() });

export const SavedLinkSchema = v.object({
  id: Id,
  url: RestorableUrlSchema,
  title: v.string(),
  order: v.number(),
  addedAt: Timestamp,
});

export const WorkspaceMetaSchema = v.object({
  id: Id,
  name: v.string(),
  color: ColorSchema,
  emoji: v.optional(v.string()),
  kind: v.picklist(["named", "unsorted"]),
  windowHint: v.optional(Int),
  resources: v.pipe(
    v.array(SavedLinkSchema),
    v.check((l: SavedLink[]) => hasUniqueIds(l), "link ids must be unique within a workspace"),
  ),
  createdAt: Timestamp,
  updatedAt: Timestamp,
  rev: NonNegInt,
});

export const WorkspaceTabsSchema = v.pipe(
  v.object({
    tabs: v.pipe(
      v.array(SavedTabSchema),
      v.check(
        (t: SavedTab[]) => hasUniqueIds(t),
        "saved tab ids must be unique within a workspace",
      ),
    ),
    activeSavedTabId: v.optional(v.string()),
    updatedAt: Timestamp,
    rev: NonNegInt,
  }),
  v.check(
    (w: WorkspaceTabs) =>
      w.activeSavedTabId === undefined || w.tabs.some((t) => t.id === w.activeSavedTabId),
    "activeSavedTabId must reference one of the tabs",
  ),
);

export const WorkspaceIndexSchema = v.pipe(
  v.array(Id),
  v.check((ids) => new Set(ids).size === ids.length, "workspace ids must be unique"),
);

export const WindowStateSchema = v.object({
  activeWorkspaceId: v.nullable(Id),
  sessionEpoch: v.string(),
  provisional: v.optional(v.boolean()),
  provisionalAt: v.optional(Timestamp),
});

/** `ws:prev:<id>` (one-deep previous tabs of a provisionally matched workspace). */
export const WorkspacePrevSchema = v.object({
  tabs: WorkspaceTabsSchema,
  savedAt: Timestamp,
});

export const SwitchOpSchema = v.object({
  id: Id,
  windowId: Int,
  from: v.nullable(Id),
  to: Id,
  stage: v.picklist(["snapshot", "opening", "activating", "closing", "done"]),
  sessionEpoch: v.string(),
  outgoingTabIds: v.array(Int),
  outgoingSavedIds: v.optional(
    v.pipe(
      v.record(v.pipe(v.string(), v.regex(/^-?\d+$/, "keys must be tab ids")), v.string()),
      v.transform((r) => r as Record<number, string>),
    ),
  ),
  createdTabIds: v.record(v.string(), Int),
  incoming: v.pipe(
    v.array(OpSavedTabSchema),
    v.check((t: SavedTab[]) => hasUniqueIds(t), "incoming saved tab ids must be unique"),
  ),
  activeSavedTabId: v.optional(v.string()),
  skipped: v.array(OpSavedTabSchema),
  startedAt: Timestamp,
  attempts: NonNegInt,
});

// ---------------------------------------------------------------- sessions / history

/**
 * `sessions:index`: generation ids (numbers, the `n` of `sessions:gen:<n>`), strictly ascending,
 * oldest first. (ARCHITECTURE §6 lists it as string[]; Keys.sessionGen takes a number, so the
 * index stores numbers.)
 */
export const SessionsIndexSchema = v.pipe(
  v.array(NonNegInt),
  v.check(
    (ids) => ids.every((id, i) => i === 0 || id > (ids[i - 1] as number)),
    "generation ids must be strictly ascending",
  ),
);

export const SessionGenerationSchema = v.object({
  id: NonNegInt,
  takenAt: Timestamp,
  windows: v.array(
    v.object({
      windowId: Int,
      workspaceId: v.nullable(Id),
      tabs: v.array(SavedTabSchema),
    }),
  ),
});

export const ClosedTabSchema = v.object({
  id: Id,
  url: RestorableUrlSchema,
  title: v.string(),
  favIconUrl: v.optional(FavIconUrlSchema),
  closedAt: Timestamp,
  workspaceId: v.optional(Id),
});

export const RecentlyClosedSchema = v.array(ClosedTabSchema);

// ---------------------------------------------------------------- dashboard records

export const TodoSchema = v.object({
  id: Id,
  text: v.string(),
  done: v.boolean(),
  order: v.number(),
  createdAt: Timestamp,
  doneAt: v.optional(Timestamp),
});

export const TodoListSchema = v.object({ items: v.array(TodoSchema), rev: NonNegInt });

export const NoteSchema = v.object({ content: v.string(), updatedAt: Timestamp, rev: NonNegInt });

export const QuickLinkSchema = v.object({
  id: Id,
  url: RestorableUrlSchema,
  title: v.string(),
  order: v.number(),
});

export const QuickLinksSchema = v.object({ items: v.array(QuickLinkSchema), rev: NonNegInt });

export const TrashItemSchema = v.variant("kind", [
  v.object({
    id: Id,
    kind: v.literal("workspace"),
    deletedAt: Timestamp,
    meta: WorkspaceMetaSchema,
    tabs: WorkspaceTabsSchema,
  }),
  v.object({
    id: Id,
    kind: v.literal("link"),
    deletedAt: Timestamp,
    workspaceId: Id,
    link: SavedLinkSchema,
  }),
  v.object({
    id: Id,
    kind: v.literal("note"),
    deletedAt: Timestamp,
    scope: Id,
    note: NoteSchema,
  }),
  v.object({
    id: Id,
    kind: v.literal("todos"),
    deletedAt: Timestamp,
    scope: Id,
    list: TodoListSchema,
  }),
]);

export const TrashSchema = v.object({ items: v.array(TrashItemSchema) });

// ---------------------------------------------------------------- settings

const D = DEFAULT_SETTINGS;
/** Longest whitelist entry (a DNS name is at most 253 characters). */
export const WHITELIST_ENTRY_MAX = 253;
const clone =
  <T>(x: T): (() => T) =>
  () =>
    structuredClone(x);

/** Missing fields (at any depth) are filled from DEFAULT_SETTINGS; present fields must be valid. */
export const SettingsSchema = v.object({
  theme: v.optional(v.picklist(["system", "light", "dark"]), D.theme),
  dashboard: v.optional(
    v.object({
      widgets: v.optional(v.array(WidgetIdSchema), clone(D.dashboard.widgets)),
      wallpaper: v.optional(
        v.object({
          kind: v.optional(v.picklist(["color", "gradient", "image"]), D.dashboard.wallpaper.kind),
          value: v.optional(v.string(), D.dashboard.wallpaper.value),
        }),
        clone(D.dashboard.wallpaper),
      ),
    }),
    clone(D.dashboard),
  ),
  suspend: v.optional(
    v.object({
      enabled: v.optional(v.boolean(), D.suspend.enabled),
      afterMinutes: v.optional(PosInt, D.suspend.afterMinutes),
      whitelist: v.optional(
        v.pipe(
          v.array(v.pipe(v.string(), v.maxLength(WHITELIST_ENTRY_MAX, "whitelist entry too long"))),
          v.maxLength(
            LIMITS.whitelistHosts,
            `whitelist has more than ${LIMITS.whitelistHosts} hosts`,
          ),
        ),
        clone(D.suspend.whitelist),
      ),
    }),
    clone(D.suspend),
  ),
  sessions: v.optional(
    v.object({
      everyMinutes: v.optional(PosInt, D.sessions.everyMinutes),
      keep: v.optional(PosInt, D.sessions.keep),
    }),
    clone(D.sessions),
  ),
  pomodoro: v.optional(
    v.object({
      workMin: v.optional(PosInt, D.pomodoro.workMin),
      breakMin: v.optional(PosInt, D.pomodoro.breakMin),
      longBreakMin: v.optional(PosInt, D.pomodoro.longBreakMin),
      roundsBeforeLong: v.optional(PosInt, D.pomodoro.roundsBeforeLong),
    }),
    clone(D.pomodoro),
  ),
  syncSettings: v.optional(v.boolean(), D.syncSettings),
  restoreLimit: v.optional(PosInt, D.restoreLimit),
  updatedAt: v.optional(PosInt),
  rev: v.optional(NonNegInt, D.rev),
});

// ---------------------------------------------------------------- misc

export const PomodoroStateSchema = v.object({
  phase: v.picklist(["work", "break", "longBreak"]),
  endsAt: Timestamp,
  round: PosInt,
});

export const MetaSchema = v.object({
  schemaVersion: NonNegInt,
  installedAt: Timestamp,
  flavor: v.picklist(["default", "newtab"]),
});

export const BackupFileSchema = v.object({
  format: v.literal("tabitat-backup"),
  version: v.literal(1),
  exportedAt: Timestamp,
  data: v.object({
    settings: v.optional(SettingsSchema, clone(D)),
    workspaces: v.array(v.object({ meta: WorkspaceMetaSchema, tabs: WorkspaceTabsSchema })),
    todos: v.optional(v.record(v.string(), TodoListSchema), () => ({})),
    notes: v.optional(v.record(v.string(), NoteSchema), () => ({})),
    quicklinks: v.optional(QuickLinksSchema, () => ({ items: [], rev: 0 })),
  }),
});

// ---------------------------------------------------------------- helpers

function parseWith<S extends v.GenericSchema>(
  name: string,
  schema: S,
  input: unknown,
): v.InferOutput<S> {
  const res = v.safeParse(schema, input);
  if (res.success) return res.output;
  const first = res.issues[0];
  throw new SchemaError(
    name,
    (first && v.getDotPath(first)) ?? "",
    res.issues.map((i) => {
      const p = v.getDotPath(i);
      return p ? `${p}: ${i.message}` : i.message;
    }),
  );
}

export const parseSavedTabGroup = (input: unknown): SavedTabGroup =>
  parseWith("SavedTabGroup", SavedTabGroupSchema, input);
export const parseSavedTab = (input: unknown): SavedTab =>
  parseWith("SavedTab", SavedTabSchema, input);
export const parseSavedLink = (input: unknown): SavedLink =>
  parseWith("SavedLink", SavedLinkSchema, input);
export const parseWorkspaceMeta = (input: unknown): WorkspaceMeta =>
  parseWith("WorkspaceMeta", WorkspaceMetaSchema, input);
export const parseWorkspaceTabs = (input: unknown): WorkspaceTabs =>
  parseWith("WorkspaceTabs", WorkspaceTabsSchema, input);
export const parseWorkspaceIndex = (input: unknown): string[] =>
  parseWith("WorkspaceIndex", WorkspaceIndexSchema, input);
export const parseWindowState = (input: unknown): WindowState =>
  parseWith("WindowState", WindowStateSchema, input);
export const parseWorkspacePrev = (input: unknown): WorkspacePrev =>
  parseWith("WorkspacePrev", WorkspacePrevSchema, input);
export const parseSwitchOp = (input: unknown): SwitchOp =>
  parseWith("SwitchOp", SwitchOpSchema, input);
export const parseSessionsIndex = (input: unknown): number[] =>
  parseWith("SessionsIndex", SessionsIndexSchema, input);
export const isSessionsIndex = (input: unknown): input is number[] =>
  v.is(SessionsIndexSchema, input);
export const parseSessionGeneration = (input: unknown): SessionGeneration =>
  parseWith("SessionGeneration", SessionGenerationSchema, input);
export const parseClosedTab = (input: unknown): ClosedTab =>
  parseWith("ClosedTab", ClosedTabSchema, input);
export const parseRecentlyClosed = (input: unknown): ClosedTab[] =>
  parseWith("RecentlyClosed", RecentlyClosedSchema, input);
export const parseTodoList = (input: unknown): TodoList =>
  parseWith("TodoList", TodoListSchema, input);
export const parseNote = (input: unknown): Note => parseWith("Note", NoteSchema, input);
export const parseQuickLinks = (input: unknown): QuickLinks =>
  parseWith("QuickLinks", QuickLinksSchema, input);
export const parseTrash = (input: unknown): Trash => parseWith("Trash", TrashSchema, input);
/**
 * A raw settings record with `suspend.whitelist` cut to the schema limits (non-strings and
 * entries over WHITELIST_ENTRY_MAX dropped, then the first LIMITS.whitelistHosts kept), for
 * records written before the limits existed. Null when the whitelist is absent or already fits.
 */
export function fitSettingsWhitelist(raw: unknown): { raw: unknown; dropped: unknown[] } | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const suspend = (raw as { suspend?: unknown }).suspend;
  if (typeof suspend !== "object" || suspend === null || Array.isArray(suspend)) return null;
  const list = (suspend as { whitelist?: unknown }).whitelist;
  if (!Array.isArray(list)) return null;
  const ok = (x: unknown): x is string => typeof x === "string" && x.length <= WHITELIST_ENTRY_MAX;
  const fits = list.filter(ok);
  const kept = fits.slice(0, LIMITS.whitelistHosts);
  if (kept.length === list.length) return null;
  const dropped = [...list.filter((x) => !ok(x)), ...fits.slice(LIMITS.whitelistHosts)];
  return { raw: { ...raw, suspend: { ...suspend, whitelist: kept } }, dropped };
}

/** `undefined` (no stored settings yet) parses to a fresh copy of DEFAULT_SETTINGS. */
export const parseSettings = (input: unknown): Settings =>
  parseWith("Settings", SettingsSchema, input === undefined ? {} : input);
export const parsePomodoroState = (input: unknown): PomodoroState =>
  parseWith("PomodoroState", PomodoroStateSchema, input);
export const parseMeta = (input: unknown): Meta => parseWith("Meta", MetaSchema, input);
export const parseBackupFile = (input: unknown): BackupFile =>
  parseWith("BackupFile", BackupFileSchema, input);

export const isSavedTabGroup = (input: unknown): input is SavedTabGroup =>
  v.is(SavedTabGroupSchema, input);
export const isSavedTab = (input: unknown): input is SavedTab => v.is(SavedTabSchema, input);
export const isSavedLink = (input: unknown): input is SavedLink => v.is(SavedLinkSchema, input);
export const isWorkspaceMeta = (input: unknown): input is WorkspaceMeta =>
  v.is(WorkspaceMetaSchema, input);
export const isWorkspaceTabs = (input: unknown): input is WorkspaceTabs =>
  v.is(WorkspaceTabsSchema, input);
export const isWindowState = (input: unknown): input is WindowState =>
  v.is(WindowStateSchema, input);
export const isSwitchOp = (input: unknown): input is SwitchOp => v.is(SwitchOpSchema, input);
export const isSessionGeneration = (input: unknown): input is SessionGeneration =>
  v.is(SessionGenerationSchema, input);
export const isClosedTab = (input: unknown): input is ClosedTab => v.is(ClosedTabSchema, input);
export const isTodoList = (input: unknown): input is TodoList => v.is(TodoListSchema, input);
export const isNote = (input: unknown): input is Note => v.is(NoteSchema, input);
export const isQuickLink = (input: unknown): input is QuickLink => v.is(QuickLinkSchema, input);
export const isTodo = (input: unknown): input is Todo => v.is(TodoSchema, input);
export const isQuickLinks = (input: unknown): input is QuickLinks => v.is(QuickLinksSchema, input);
export const isTrash = (input: unknown): input is Trash => v.is(TrashSchema, input);
export const isTrashItem = (input: unknown): input is TrashItem => v.is(TrashItemSchema, input);
/** Note: Settings fills defaults, so a partial object is "valid" for parseSettings but not here. */
export const isSettings = (input: unknown): input is Settings =>
  v.is(SettingsSchema, input) && hasAllKeys(input, DEFAULT_SETTINGS);
export const isPomodoroState = (input: unknown): input is PomodoroState =>
  v.is(PomodoroStateSchema, input);
export const isMeta = (input: unknown): input is Meta => v.is(MetaSchema, input);
export const isBackupFile = (input: unknown): input is BackupFile => v.is(BackupFileSchema, input);

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

/** True when every key of `shape` (recursively through plain objects) is present in `input`. */
function hasAllKeys(input: unknown, shape: unknown): boolean {
  if (!isPlainObject(shape)) return true;
  if (!isPlainObject(input)) return false;
  return Object.entries(shape).every(
    ([k, sub]) => Object.hasOwn(input, k) && hasAllKeys(input[k], sub),
  );
}
