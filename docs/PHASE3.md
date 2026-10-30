# Phase 3 spec — suspension, duplicates, trash/undo, options, settings sync, bookmarks import

Builds on `docs/ARCHITECTURE.md` (§2.1, §5.7, §10, §11) and `docs/UI-SPEC.md`.
Everything here is additive to the Phase 1/2 contracts (`src/core/model/types.ts`,
`src/messaging/commands.ts`); nothing existing changes shape. Rules from the
UI spec still hold: UI never writes `chrome.storage`; saved state changes go
through `send()`; strings via `t()`; no network; keyboard first.

## 1. Contract additions (done in the main tree before implementation)

### Commands (`src/messaging/commands.ts`)

| Command | in | out | Lane(s) | Notes |
|---|---|---|---|---|
| `tabs.suspend` | `{ tabId }` | `null` | `window:<id>` | Discards one tab now. Rejects `invalid` when the tab is active, pinned, audible, already discarded, a placeholder, or a non-http(s) URL (same rule as `eligibleForDiscard` with `afterMinutes: 0`, whitelist ignored because the user asked). `busy` when the window has a switch op. |
| `settings.syncNow` | `{}` | `SyncStatus` | `key:settings` | Forces a push (local → sync) or pull (sync → local) by `updatedAt` LWW; see §4. `invalid` when `syncSettings` is off. |
| `import.bookmarks` | `{ entries: BookmarkEntry[]; target: ImportTarget }` | `ImportBookmarksReport` | `key:quicklinks` or `ws:index` + `*`-free | See §6. |
| `recovery.dismissHint` | `{}` | `null` | `global` | Removes `recovery:hint`. |

Types (in `commands.ts` next to `ImportReport`):

```ts
export interface BookmarkEntry { path: string[]; title: string; url: string }
export type ImportTarget =
  | { kind: "quicklinks" }
  | { kind: "workspace"; name: string; color: Color }
  | { kind: "workspacePerFolder"; color: Color };
export interface ImportBookmarksReport {
  added: number; skipped: number; workspaces: WorkspaceId[]; warnings: string[];
}
export interface SyncStatus {
  enabled: boolean; lastPushAt?: number; lastPullAt?: number; error?: string;
}
```

### Model (`src/core/model/types.ts`)

- `Settings.updatedAt?: number` — set by the worker on every `settings.update`;
  used for sync last-write-wins. Absent on fresh installs until first update.
- `LIMITS.quickLinks = 100`, `LIMITS.linksPerWorkspace = 200`,
  `LIMITS.importEntries = 2000`, `LIMITS.importWorkspaces = 50`,
  `LIMITS.whitelistHosts = 200`.

### Storage keys (background-owned, `src/background/keys.ts`)

- `sync:status` (storage.local): `SyncStatus`. Read by the options page.
- `recovery:hint` (storage.local): `{ generation: number; unmatchedWindows: number; at: number }`,
  written by the reconciler when the latest session generation has windows that
  no live window matched after a browser restart (the "you may have lost a
  window" case). Cleared by `recovery.dismissHint`, by `session.restore`, and
  whenever a new generation is written with every window matched.
- `storage.sync` item `settings` (only when `syncSettings` is on): the
  `Settings` object without `rev`. Never anything else (ARCHITECTURE §10).

## 2. Suspension UI

- **Tab rows** (popup + side panel): discarded tabs render dimmed with a
  "suspended" glyph (`IconSleep`) after the title, `title` tooltip "Suspended".
  New row action **Suspend** (key `z`) → `tabs.suspend`; hidden for active,
  pinned, audible, discarded, placeholder and non-http(s) tabs. New row action
  **Never suspend this site** (in the row menu only) → `settings.update`
  `{ suspend: { whitelist: [...cur, host] } }` (dedupe via
  `normalizeWhitelistEntry`); shown as "Allow suspending this site" when the
  host is already whitelisted.
- **Window actions** footer: "Suspend others" exists; its toast gains the count
  (already) and, when suspension is disabled, a secondary line "Auto-suspend
  is off · Turn on" linking to the options page.
- **Options → Suspension** (§5) owns enable / minutes / whitelist editing.
- No change to the placeholder page's behavior; its look is refreshed: theme
  tokens, favicon, title, host, "Click or press any key to load", and a
  "Suspended by Tabitat" footer. Strings via `chrome.i18n.getMessage` directly
  (framework-free script; add the keys to `messages.json`).

## 3. Duplicate detection UX

- **Tab rows**: a tab that is part of a duplicate group (per `findDuplicates`
  over the current window, computed in `store.ts` as `duplicateGroups`) shows a
  "duplicate" chip after the title; the row that `findDuplicates` ranks first
  in its group (the one kept) shows no chip. Chip tooltip: "Also open as tab N"
  is not needed; keep "Duplicate".
- **Tabs section header**: when `windowDuplicates > 0`, a filter toggle
  "Duplicates (N)" shows only duplicate groups (kept row first, then the
  extras), with per-row Close. "Close N dupes" (footer) stays.
- **Undo**: after "Close N dupes" the toast offers **Undo** for 8 s: it
  recreates the closed tabs as placeholders (`buildPlaceholderUrl`, UI may
  create tabs) in the same window, at the end. The URLs/titles come from the
  `UiTab`s the UI had before the call (the worker's return is a count).
- **Side panel only**: "Close duplicates in all windows" in the Tabs section
  menu → `tabs.closeDuplicates {}`.
- **Saved links**: adding a link whose normalized URL already exists in the
  workspace shows an inline notice "Already saved" and does not call `link.add`.

## 4. Settings sync (`storage.sync`, opt-in)

Worker (`src/background/settings-sync.ts`):

- On `settings.update` when `syncSettings` is on: write `settings` (minus `rev`)
  to `storage.sync`. If the serialized size exceeds `QUOTA_BYTES_PER_ITEM`
  (8192) or the write throws, keep local, set `sync:status.error` to a short
  code (`too_large` | `quota` | `unavailable`), do not retry in a loop.
- On startup (after migrations) and on `storage.onChanged` for area `sync`,
  key `settings`: validate with `parseSettings` (drop unknown fields, fall back
  on invalid); apply when remote `updatedAt` > local `updatedAt` by writing
  local `settings` with remote values, `rev: local.rev + 1`, and the remote
  `updatedAt` (not now), so the change does not bounce back. Run alarm repair
  if `sessions.everyMinutes` or `suspend.enabled` changed.
- Turning `syncSettings` on pushes immediately (and pulls first if remote is
  newer). Turning it off leaves the remote copy (other devices may still use
  it) and clears `sync:status` to `{ enabled: false }`.
- `settings.syncNow` performs one pull-then-push and returns the status.
- `theme` and `dashboard.wallpaper` with `kind: "image"` are device-specific:
  `theme` is never part of the pushed object (the local theme is kept on pull),
  and `dashboard.wallpaper` is excluded when `kind === "image"` (keep the local
  one on pull).

UI: options page section (§5) shows status (last push/pull, error text via
`t()` codes), a "Sync now" button, and the privacy sentence "Only settings are
synced. Tabs, notes and todos never leave this device."

## 5. Options page (`src/entrypoints/options`, Preact, shares `src/ui`)

Layout: left nav (sticky at ≥ 720 px, top tabs below), content max 720 px.
Sections (ids are URL hashes, `options.html#suspension` opens that section):

1. **General**: theme (system / light / dark), restore limit (number, 10–500,
   explains "tabs opened per switch; the rest are listed as skipped"),
   "Open side panel on startup" is *not* in v1 (skip).
2. **Suspension**: enable toggle (default off, with the one-paragraph caveat
   from ARCHITECTURE §5.7 about unsaved form input), minutes (any whole number
   5–720; amended in the review pass, no step), whitelist editor (one host per
   line textarea + chips; normalized with `normalizeWhitelistEntry`; invalid
   lines flagged and nothing saved while any line is invalid; saved on blur and
   when leaving the section; max `LIMITS.whitelistHosts`).
3. **Sessions**: snapshot every N minutes (1–60), keep N generations (3–30),
   "Take a snapshot now" → `session.snapshotNow`, link to the recovery page.
4. **Pomodoro**: work / break / long break minutes, rounds before long break.
5. **Sync**: §4.
6. **Shortcuts**: table from `chrome.commands.getAll()` (name, description,
   current key or "Not set"), button "Change in Chrome" →
   `chrome.tabs.create({ url: "chrome://extensions/shortcuts" })`.
7. **Bookmarks import**: §6.
8. **Data**: Export backup (same as recovery page), Import (link to recovery
   page), "Empty trash" (confirm dialog, `trash.purge {}`), storage usage
   (`chrome.storage.local.getBytesInUse`), "Reset all settings" (confirm,
   `settings.update` with `DEFAULT_SETTINGS` fields).
9. **About**: version (`chrome.runtime.getManifest().version`), flavor
   (`meta.flavor`), license MIT, link to repository, privacy summary.

Behavior: every control writes through `settings.update` with `expectedRev`;
writes are queued in order and each remembers the rev it was made against: a
patch overtaken by a change from elsewhere is not sent. On a stale patch or a
`conflict`, drop the queue, reload from storage and show "Settings changed
elsewhere, reloaded". Inputs save on change (debounced 300 ms for text/number), with a
transient "Saved" indicator per section. Keyboard: all controls native,
focus-visible from the theme, section nav is a `nav` with `aria-current`.
Theme applied via `applyTheme` like the popup.

## 6. Bookmarks import (optional permission `bookmarks`)

UI (options → Bookmarks import):

1. "Choose bookmarks…" → `chrome.permissions.request({ permissions: ["bookmarks"] })`
   (must run in the click handler). Denied → notice, nothing else.
2. Folder tree from `chrome.bookmarks.getTree()`: folders only, each with its
   recursive link count; checkboxes per folder (checking a parent checks its
   subtree); "Bookmarks bar" / "Other bookmarks" expanded by default.
3. Destination radio: **Quick links** (flat; cap `LIMITS.quickLinks` total,
   shows how many will be skipped), **One workspace** (name prefilled with the
   top folder's name, color picker), **One workspace per selected folder**:
   - exactly one topmost selected folder (selected, no selected ancestor): one
     `workspacePerFolder` import with `root` = that folder's path; its direct
     child folders become workspaces and its own links go to a workspace named
     after it (an empty selected folder still anchors the mapping);
   - two or more topmost selected folders (e.g. one under "Bookmarks bar" and
     one under "Other bookmarks"): one `{ kind: "workspace" }` import per
     topmost folder, named after it, holding every selected link beneath it
     (at most `LIMITS.importWorkspaces` folders). Never the common parent as
     root, which would turn "Bookmarks bar" / "Other bookmarks" into workspaces.
   Same-named sibling folders under the root merge into one workspace (Chrome
   allows them; it is rare and merging is the least surprising result).
4. Preview line: "N links · M folders · K skipped (unsupported URLs)", then
   "Will add A, skip S." with translated warnings, from the worker's own planner
   (`planBookmarkImport`, run per import and summed) against the current quick
   links. Only `http(s)`, `file`, `ftp` URLs are sent (`classifyUrl ===
   "placeholder"`); the UI filters, the worker re-validates. Entries are fitted
   to the RPC limits before sending (folder names 200 characters, titles 2000,
   paths 32 folders deep; "N paths shortened" in the preview), so one odd
   bookmark cannot reject the whole import.
5. "Import" → `import.bookmarks`; result line with counts and warnings;
   "Remove bookmarks permission" link (`chrome.permissions.remove`) shown after
   a successful import.

Worker: validates every URL (rejects `javascript:` / `data:` / `vbscript:`
etc.), enforces `LIMITS.importEntries`, `LIMITS.importWorkspaces`,
`LIMITS.linksPerWorkspace`, `LIMITS.quickLinks`, dedupes by normalized URL
within a destination (skip counted), writes each destination atomically
(`setMany`) under its lanes, never touches live windows. Names are trimmed to
the `Name` schema length; empty folder names become "Imported".

## 7. Trash / undo polish

- Recovery page → Trash: each item shows "Purged in N days" (from
  `deletedAt + LIMITS.trashRetentionMs`), kind glyph, item count for
  workspaces; "Empty trash" button with confirm; "Restore" / "Delete now" per
  item (exists). Items sorted newest first.
- Trash purge alarm `trash-purge` already exists (`purgeExpiredTrash`); the
  options Data section shows "Trash: N items" via `trash` storage key.
- Undo toasts: close duplicates (§3), workspace delete and link remove (exist),
  **tab close from a row** → recently closed already captures it; the toast
  "Closed “title” · Undo" reopens it as a placeholder.

## 8. Deferred review items landing in Phase 3

- `recovery:hint` banner (§1): `RecoveryBanner` shows "A window from your last
  session was not restored · Open recovery" when the hint exists.
- Drag a tab row onto the Saved links section → `tabs.park` (HTML5 DnD,
  `dataTransfer` type `application/x-tabitat-tab` carrying the tab id; drop
  zone highlights; keyboard path is the existing `p`).
- Quick links in search: store reads `quicklinks`; search index includes them
  as kind `quicklink` (opens in a new tab).
- Component tests: add `happy-dom` + `@testing-library/preact` (dev deps) and a
  Vitest environment for `*.dom.test.tsx`; cover TabRow keys (`p`, `z`,
  ContextMenu menu), useRoving focus recovery, the options whitelist editor,
  and the bookmarks folder picker (with a fake `chrome.bookmarks`).
- `TabRow.tsx` split: row shell + `RowActions.tsx` (menu + buttons), each ≤ 120
  lines.

## 9. Out of scope for Phase 3

Dashboard widgets, HTML export, backup reminder, perf CI gate (Phase 4);
grid-pattern lists / axe (Phase 5); per-tab "suspend after" overrides;
suspending to our own placeholder page (we use `tabs.discard`).

## 10. Acceptance

- `npm run check`, both builds, `npx playwright test --project=e2e` green,
  plus new e2e: (f) options page edits suspension settings and the stored
  `settings` reflects them with `rev` bumped; (g) `tabs.suspend` on a seeded
  background tab marks it discarded and the row shows the glyph; (h) bookmarks
  import into quick links with a fake tree (grant via
  `chrome.permissions.request` is a user gesture; in e2e stub
  `chrome.bookmarks.getTree` through the fake page context or test the worker
  command directly).
- Unit: `settings-sync` LWW both directions, size guard, no bounce;
  `import.bookmarks` validation, limits, dedupe, per-folder mapping;
  `tabs.suspend` eligibility; reconciler hint set/cleared.
- Reviewed by Codex + Gemini; triage in `docs/reviews/phase3-triage.md`;
  tag `phase-3`.
