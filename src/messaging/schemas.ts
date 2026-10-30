/**
 * valibot schemas for every RPC payload (validated by the worker's CommandRouter).
 * Record-level policies (URL schemes, defaults) reuse core's schemas.
 */
import * as v from "valibot";
import {
  ColorSchema,
  IdSchema,
  QuickLinkSchema,
  RestorableUrlSchema,
  TodoSchema,
} from "../core/model/schemas";
import { LIMITS } from "../core/model/types";
import type { CommandType } from "./commands";

/** Same id policy as the stored records (core IdSchema). */
const Id = IdSchema;
const WindowId = v.pipe(v.number(), v.integer());
const TabId = v.pipe(v.number(), v.integer(), v.minValue(0));
const Rev = v.optional(v.pipe(v.number(), v.integer(), v.minValue(0)));
const Empty = v.object({});
const Name = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(200));
const ScopeSchema = Id;

const SETTINGS_KEYS = [
  "theme",
  "dashboard",
  "suspend",
  "sessions",
  "pomodoro",
  "syncSettings",
  "restoreLimit",
] as const;

/** Top-level keys only; the merged result is validated with core's SettingsSchema. */
const SettingsPatch = v.pipe(
  v.record(v.string(), v.unknown()),
  v.check(
    (p) => Object.keys(p).every((k) => (SETTINGS_KEYS as readonly string[]).includes(k)),
    "unknown settings key",
  ),
);

export const PayloadSchemas = {
  "workspace.create": v.object({
    name: Name,
    color: ColorSchema,
    fromWindowId: v.optional(WindowId),
  }),
  "workspace.update": v.object({
    id: Id,
    patch: v.object({
      name: v.optional(Name),
      color: v.optional(ColorSchema),
      emoji: v.optional(v.pipe(v.string(), v.maxLength(16))),
    }),
    expectedRev: Rev,
  }),
  "workspace.reorder": v.object({ ids: v.array(Id) }),
  "workspace.delete": v.object({ id: Id }),
  "workspace.switch": v.object({ windowId: WindowId, workspaceId: Id }),
  "workspace.open": v.object({ workspaceId: Id }),
  "workspace.next": v.object({
    windowId: WindowId,
    direction: v.union([v.literal(1), v.literal(-1)]),
  }),
  "link.add": v.object({
    workspaceId: Id,
    url: RestorableUrlSchema,
    title: v.pipe(v.string(), v.maxLength(2000)),
  }),
  "link.remove": v.object({ workspaceId: Id, linkId: Id }),
  "tabs.park": v.object({ tabId: TabId, workspaceId: Id }),
  "tabs.suspendOthers": v.object({ windowId: WindowId }),
  "tabs.closeDuplicates": v.object({ windowId: v.optional(WindowId) }),
  "tabs.suspend": v.object({ tabId: TabId }),
  "session.restore": v.object({ generation: v.pipe(v.number(), v.integer(), v.minValue(0)) }),
  "session.snapshotNow": Empty,
  "backup.export": Empty,
  "backup.import": v.object({ file: v.unknown(), mode: v.picklist(["replace", "merge"]) }),
  "todo.set": v.object({ scope: ScopeSchema, items: v.array(TodoSchema), expectedRev: Rev }),
  "note.set": v.object({
    scope: ScopeSchema,
    content: v.pipe(v.string(), v.maxLength(1_000_000)),
    expectedRev: Rev,
  }),
  "quicklink.set": v.object({ items: v.array(QuickLinkSchema), expectedRev: Rev }),
  "settings.update": v.object({ patch: SettingsPatch, expectedRev: Rev }),
  "settings.syncNow": Empty,
  "import.bookmarks": v.object({
    entries: v.pipe(
      v.array(
        v.object({
          path: v.pipe(v.array(v.pipe(v.string(), v.maxLength(200))), v.maxLength(32)),
          title: v.pipe(v.string(), v.maxLength(2000)),
          url: RestorableUrlSchema,
        }),
      ),
      v.maxLength(LIMITS.importEntries),
    ),
    target: v.variant("kind", [
      v.object({ kind: v.literal("quicklinks") }),
      v.object({ kind: v.literal("workspace"), name: Name, color: ColorSchema }),
      v.object({ kind: v.literal("workspacePerFolder"), color: ColorSchema }),
    ]),
  }),
  "trash.restore": v.object({ trashId: Id }),
  "trash.purge": v.object({ trashId: v.optional(Id) }),
  "pomodoro.start": Empty,
  "pomodoro.stop": Empty,
  "pomodoro.skip": Empty,
  "op.status": v.object({ windowId: WindowId }),
  "recovery.dismiss": v.object({
    opIds: v.optional(v.array(v.pipe(v.string(), v.maxLength(200)))),
  }),
  "recovery.dismissHint": Empty,
  "system.purgeCorrupt": v.object({
    keys: v.optional(
      v.array(
        v.pipe(
          v.string(),
          v.maxLength(1000),
          v.check(
            (k: string) => k.startsWith("corrupt:") || k === "import:failed",
            "only corrupt:* keys and import:failed may be purged",
          ),
        ),
      ),
    ),
  }),
  "system.ping": Empty,
} satisfies Record<CommandType, v.GenericSchema>;
