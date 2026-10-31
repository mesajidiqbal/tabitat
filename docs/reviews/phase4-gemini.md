# Phase 4 Review: Tabitat (MV3 Chrome Extension)

---

### (1) Verdict

**DO NOT APPROVE (Request Changes before tagging `phase-4`)**

**Why:**
1. **Critical Spec Gaps**: The Dashboard omits `BackupBanner` ([docs/PHASE4.md](file:///Users/sajid/Developer/personal/tabitat/docs/PHASE4.md#L83-L84) §3), and required e2e test `(l)` for recovery HTML export is missing ([docs/PHASE4.md](file:///Users/sajid/Developer/personal/tabitat/docs/PHASE4.md#L181-L182) §8).
2. **Correctness & Runtime Bugs**:
   - Dashboard window ID tracking via `chrome.windows.getCurrent()` and `onFocusChanged` breaks new-tab isolation and can pass `windowId: null` to `workspace.switch`.
   - Markdown link parsing truncates any URL containing parentheses (e.g. Wikipedia).
   - `recordBackup` accesses undocumented property `repo.store.get`, risking worker runtime exceptions after backups.
   - `BackupBanner` turn-off sends `expectedRev: 0` when settings are not preloaded, causing immediate revision conflicts.
   - Wallpaper image blobs up to 5 MB leak permanently in IndexedDB when users switch to a color swatch or gradient.
3. **Accessibility**: Severe WCAG contrast failures when light/dark wallpapers are used with mismatched themes.

---

### (2) Correctness Bugs

#### 1. Dashboard `windowId` tracking breaks on new-tab pages and focus transitions
- **File & Line**: [src/ui/store.ts#L2467-L2472](file:///Users/sajid/Developer/personal/tabitat/src/ui/store.ts#L2467-L2472), [src/ui/store.ts#L2646-L2652](file:///Users/sajid/Developer/personal/tabitat/src/ui/store.ts#L2646-L2652)
- **Failure Scenario**: `dashboard.html` is a tab page (not a popup). On startup, `resolveWindowId()` relies on `chrome.windows.getCurrent()`. Furthermore, line 2647 listens to `chrome.windows.onFocusChanged` and re-evaluates `resolveWindowId()`. If the user has multiple windows or switches focus to another application (where `onFocusChanged` yields `-1`), `store.windowId` evaluates to `null` or tracks the newly focused foreign window. When `store.windowId.value` is null, `activeWorkspaceId` becomes null, active scope in Todos/Notes falls back to `"global"`, and clicking a workspace row sends `workspace.switch` with `{ windowId: null }`, failing valibot schema validation.
- **Severity**: High.
- **Fix**: In tab pages, resolve the window ID once on mount using `chrome.tabs.getCurrent().then(tab => tab?.windowId)` (which is immutable for the lifetime of that tab) and do NOT listen to `chrome.windows.onFocusChanged` unless running inside a popup viewer.

#### 2. `BackupBanner` turn-off sends `expectedRev: 0` when settings are pending
- **File & Line**: [src/ui/sections/BackupBanner.tsx#L2932-L2935](file:///Users/sajid/Developer/personal/tabitat/src/ui/sections/BackupBanner.tsx#L2932-L2935)
- **Failure Scenario**: When `onTurnOff` is omitted (e.g. popup or dashboard), `turnOff` sends `expectedRev: settings?.rev ?? 0`. If clicked before `useStorageKey(Keys.settings)` resolves, `expectedRev` defaults to `0`. On any initialized system, `settings.rev >= 1`. `checkRev(cur.rev, 0, "settings")` in [src/background/handlers.ts#L1490](file:///Users/sajid/Developer/personal/tabitat/src/background/handlers.ts#L1490) throws `RpcError("conflict")`, displaying an error and preventing the user from disabling the reminder.
- **Severity**: Medium.
- **Fix**: Omit the `?? 0` fallback (`expectedRev: settings?.rev`), or disable the button while `!settings`. When `expectedRev` is undefined, `checkRev` skips the revision check.

#### 3. Markdown links truncate URLs containing parentheses
- **File & Line**: [src/core/notes/markdown.ts#L776-L777](file:///Users/sajid/Developer/personal/tabitat/src/core/notes/markdown.ts#L776-L777)
- **Failure Scenario**: Given `[Closure](https://en.wikipedia.org/wiki/Closure_(computer_programming))`, line 776 does `const paren = s.indexOf(")", close + 2)`. It matches the inner closing parenthesis in `(computer_programming)`. The target URL becomes `https://en.wikipedia.org/wiki/Closure_(computer_programming`, truncating the link and leaving the trailing `)` as dangling text.
- **Severity**: Medium.
- **Fix**: Track balanced parentheses within the link destination instead of matching the first `)` character.

#### 4. `recordBackup` accesses unverified `repo.store.get`
- **File & Line**: [src/background/backup-reminder.ts#L914](file:///Users/sajid/Developer/personal/tabitat/src/background/backup-reminder.ts#L914)
- **Failure Scenario**: Line 914 executes `if ((await repo.store.get(BgKeys.backupReminder)) !== undefined) await repo.remove(BgKeys.backupReminder)`. `repo` is a `StorageRepository` (which provides `repo.read`, `repo.remove`, `repo.setMany`). If `repo` does not expose an underlying `store` object, `repo.store.get` throws `TypeError: Cannot read properties of undefined (reading 'get')`. This causes `recordBackup` to reject after every backup generation.
- **Severity**: Medium.
- **Fix**: Remove the existence check and invoke `await repo.remove(BgKeys.backupReminder)` directly (Chrome storage removal of a non-existent key is a safe no-op).

#### 5. Wallpaper image blob leaks in IndexedDB when choosing gradient or color swatch
- **File & Line**: [src/entrypoints/dashboard/WallpaperPicker.tsx#L3528](file:///Users/sajid/Developer/personal/tabitat/src/entrypoints/dashboard/WallpaperPicker.tsx#L3528), [src/entrypoints/dashboard/WallpaperPicker.tsx#L3543](file:///Users/sajid/Developer/personal/tabitat/src/entrypoints/dashboard/WallpaperPicker.tsx#L3543)
- **Failure Scenario**: When a user uploads a 5 MB image, it is stored in IndexedDB (`blobs/wallpaper`). If they later select a gradient preset or color swatch, `set({ kind: "gradient", value: name })` or `set({ kind: "color", value: hex })` updates the setting but never invokes `deleteImage()`. The 5 MB blob remains orphaned in IndexedDB indefinitely.
- **Severity**: Medium.
- **Fix**: In `WallpaperPicker.tsx`, invoke `deleteImage().catch(() => undefined)` whenever switching to a gradient or color preset.

#### 6. Wallpaper `remove()` deletes blob before setting update is acknowledged
- **File & Line**: [src/entrypoints/dashboard/WallpaperPicker.tsx#L3508-L3512](file:///Users/sajid/Developer/personal/tabitat/src/entrypoints/dashboard/WallpaperPicker.tsx#L3508-L3512)
- **Failure Scenario**: `remove()` calls `await deleteImage()` first, then calls `await set(...)`. If `set()` fails (e.g. revision conflict on `settings.update` from another open tab), the image blob in IndexedDB is already destroyed, but the setting still points to `{ kind: "image", value: "idb:wallpaper" }`.
- **Severity**: Low / Medium.
- **Fix**: Await `set(...)` first; delete the blob in IndexedDB only after the setting update succeeds.

#### 7. Queued operations in `useSyncedRecord` dropped or stalled on non-conflict failure
- **File & Line**: [src/ui/widgets/useSyncedRecord.ts#L5133](file:///Users/sajid/Developer/personal/tabitat/src/ui/widgets/useSyncedRecord.ts#L5133), [src/ui/widgets/useSyncedRecord.ts#L5155](file:///Users/sajid/Developer/personal/tabitat/src/ui/widgets/useSyncedRecord.ts#L5155)
- **Failure Scenario**: `flush()` snapshots `n = ops.current.length`. While `write` is in flight, the user enqueues 2 new operations (e.g. quick link edits). If `write` rejects with a non-conflict error (e.g. `invalid` or network/RPC error), line 5155 executes `ops.current.splice(0, n)`. The newly enqueued operations remain in `ops.current`, but `flush()` is not re-triggered because `again.current` was never set. They remain stalled in memory until another UI interaction occurs.
- **Severity**: Low / Medium.
- **Fix**: Check `if (ops.current.length > 0) flush()` inside `finally`.

#### 8. Lazy continuation in markdown parser swallows following paragraphs
- **File & Line**: [src/core/notes/markdown.ts#L850-L856](file:///Users/sajid/Developer/personal/tabitat/src/core/notes/markdown.ts#L850-L856)
- **Failure Scenario**: If a note contains:
  ```markdown
  - Item 1
  Paragraph text immediately following
  ```
  Because `st.list` is active, line 854 unconditionally appends `\nParagraph text...` to `Item 1`. The user cannot start a normal paragraph after a list without inserting an empty line or a heading.
- **Severity**: Low.
- **Fix**: Only treat lines as list continuations if they are indented with whitespace, or require list items to end when encountering unindented non-bullet lines.

---

### (3) Architecture & Privacy Violations

1. **HTML Export leaks query strings in Tab Titles ([src/core/export/html.ts#L526-L527](file:///Users/sajid/Developer/personal/tabitat/src/core/export/html.ts#L526-L527))**:
   - `opts.stripQuery` sanitizes `real` via `stripQueryAndHash(real)`. However, when a tab title was defaulted from an initial URL containing secrets or tokens (e.g. `https://example.com/auth?token=secret`), `title` is preserved verbatim as `title`, completely bypassing query stripping in `<A HREF="...">title</A>`.
   - **Fix**: If `opts.stripQuery` is active, apply `stripQueryAndHash` to `title` if `title` is a URL containing query parameters.
2. **Missing `BackupBanner` in Dashboard violates Spec §3 ([src/entrypoints/dashboard/App.tsx#L3082-L3145](file:///Users/sajid/Developer/personal/tabitat/src/entrypoints/dashboard/App.tsx#L3082-L3145))**:
   - [docs/PHASE4.md#L83-L84](file:///Users/sajid/Developer/personal/tabitat/docs/PHASE4.md#L83-L84) mandates `BackupBanner` in the dashboard. It is absent in `App.tsx` and omitted from dashboard read subscriptions.
3. **Storage Access Conformance**:
   - The UI adheres strictly to ADR-003: UI surfaces read storage via `chrome.storage.local.get` / `onChanged` and write exclusively via `send()`. The only storage write in UI code is the documented device-local media exception in `tabitat/blobs` (IndexedDB).

---

### (4) Accessibility Issues with Concrete Fixes

1. **Wallpaper Contrast Failure on Clock and Header (WCAG 1.4.3 Contrast Minimum)**:
   - **Issue**: Clock (`time`, `date`, `greeting`), customize gear button, search hints, and empty states render directly on the wallpaper background (`.page` in `App.tsx`). Light wallpapers (`#f5f6f8`, `mist`) paired with light theme (or dark wallpapers paired with dark theme) produce near-invisible text.
   - **Fix**: In [src/entrypoints/dashboard/dashboard.module.css](file:///Users/sajid/Developer/personal/tabitat/src/entrypoints/dashboard/dashboard.module.css), wrap the clock and top controls in a semi-transparent card container (`background: var(--bg-card-scrim, rgba(0, 0, 0, 0.35)); backdrop-filter: blur(12px); border-radius: var(--radius-md)`), or apply a text-shadow scrim (`text-shadow: 0 1px 3px rgba(0, 0, 0, 0.8)`).
2. **Customize Panel Dialog Lacks Focus Trap and Modal Semantics (WCAG 2.4.3 Focus Order)**:
   - **Issue**: [src/entrypoints/dashboard/Customize.tsx#L3199](file:///Users/sajid/Developer/personal/tabitat/src/entrypoints/dashboard/Customize.tsx#L3199) sets `role="dialog"`, but lacks `aria-modal="true"`. Tabbing allows keyboard focus to escape the panel into the main dashboard grid behind it.
   - **Fix**: Add `aria-modal="true"` and an active focus-trap keydown handler (wrapping Tab between the close button and the last interactive element).
3. **Inaccessible Swatch Button Labels (WCAG 1.1.1 Non-text Content)**:
   - **Issue**: In [src/entrypoints/dashboard/WallpaperPicker.tsx#L3525](file:///Users/sajid/Developer/personal/tabitat/src/entrypoints/dashboard/WallpaperPicker.tsx#L3525), swatches use `aria-label={t("dashWallpaperGradient", i + 1)}` ("Gradient 1", "Color 1"). Screen reader users receive no color description.
   - **Fix**: Map swatch names and gradient IDs to descriptive labels (e.g. `t("dashWallpaperGradient_aurora")`: "Aurora: turquoise to pink gradient").
4. **Focus Reset on Widget Reorder in Customize Panel**:
   - **Issue**: In [src/entrypoints/dashboard/Customize.tsx#L3237-L3243](file:///Users/sajid/Developer/personal/tabitat/src/entrypoints/dashboard/Customize.tsx#L3237-L3243), clicking Move Up or Move Down triggers `updateSettings`, which re-renders the list. The button unmounts and remounts at a different index, dumping keyboard focus to `<body>`.
   - **Fix**: Track the actively moved widget ID and restore focus to its corresponding Move button after re-render using a `useEffect`.
5. **Missing Status Announcement on Pomodoro Phase Transition (WCAG 4.1.3 Status Messages)**:
   - **Issue**: [src/ui/widgets/Pomodoro.tsx#L4044](file:///Users/sajid/Developer/personal/tabitat/src/ui/widgets/Pomodoro.tsx#L4044) properly sets `aria-live="off"` on the 1s timer, but the phase indicator ([src/ui/widgets/Pomodoro.tsx#L4043](file:///Users/sajid/Developer/personal/tabitat/src/ui/widgets/Pomodoro.tsx#L4043)) has no `aria-live` or `role="status"`. Phase changes (Work -> Break) pass unannounced.
   - **Fix**: Add `role="status" aria-live="polite"` to the phase container or an offscreen live-region message triggered on phase switch.
6. **Quick Links Tile Keyboard Reorder Alternative**:
   - **Issue**: Quick links support mouse drag-and-drop, but keyboard reordering requires navigating through the 3-dots popup menu (`Menu` -> `Move left` / `Move right`).
   - **Fix**: Support `Alt+ArrowLeft` and `Alt+ArrowRight` directly on the focused `QuickLinkTile` `<a>` tag, matching the keyboard-first design of `TodoRow`.

---

### (5) UX Gaps against `docs/PHASE4.md`

1. **Drag Reorder of Widgets in Customize Panel Omitted**:
   - [docs/PHASE4.md#L91-L92](file:///Users/sajid/Developer/personal/tabitat/docs/PHASE4.md#L91-L92) specifies: `widget toggles (checkbox list, drag or ▲▼ reorder)`. Only ▲▼ buttons are implemented in `Customize.tsx`; drag-and-drop reordering is not supported.
2. **Missing Action Button in Workspaces & Dashboard Empty States**:
   - [docs/PHASE4.md#L146](file:///Users/sajid/Developer/personal/tabitat/docs/PHASE4.md#L146) specifies: `Empty states for every widget (one line + the primary action)`.
   - In [src/ui/widgets/WorkspacesWidget.tsx#L5252](file:///Users/sajid/Developer/personal/tabitat/src/ui/widgets/WorkspacesWidget.tsx#L5252), `<EmptyState title={...} hint={...} />` has no action button (should provide a "New workspace" button).
   - In [src/entrypoints/dashboard/App.tsx#L3134](file:///Users/sajid/Developer/personal/tabitat/src/entrypoints/dashboard/App.tsx#L3134), `{gridWidgets.length === 0 && <p class={s.empty}>{t("dashNoWidgets")}</p>}` provides text without a button to open the Customize panel.

---

### (6) Performance Concerns

1. **Initial Paint Over-fetching of All Workspace Tabs**:
   - In [src/ui/store.ts#L2590-L2594](file:///Users/sajid/Developer/personal/tabitat/src/ui/store.ts#L2590-L2594), `initStore()` queries `ws:tabs:<id>` for all workspaces on first paint. The dashboard only needs tab counts, but loads full tab objects for all workspaces before rendering.
   - **Fix**: Store tab counts in `ws:meta:<id>` or defer loading `ws:tabs:*` records until cards are expanded/hovered.
2. **Favicon Request Flood on Dashboard Open**:
   - In [src/ui/widgets/QuickLinkTile.tsx#L4440](file:///Users/sajid/Developer/personal/tabitat/src/ui/widgets/QuickLinkTile.tsx#L4440), `<img src={icon} decoding="async" />` lacks `loading="lazy"`. With up to 50 quick links, opening a new tab issues up to 50 simultaneous requests to Chrome's `_favicon` endpoint.
   - **Fix**: Add `loading="lazy"` to `<img />` in `QuickLinkTile.tsx`.
3. **Monolithic Code-split Chunks for All Widgets**:
   - In [src/ui/widgets/index.ts](file:///Users/sajid/Developer/personal/tabitat/src/ui/widgets/index.ts), all widgets are bundled into a single barrel export. Loading any single widget (e.g. `SearchWidget`) downloads the full bundle containing `Notes`, markdown parser, `Todos`, and `Pomodoro`.
   - **Fix**: Code-split large dependencies (particularly the markdown AST renderer and editor) into separate dynamic import chunks.
4. **Pomodoro Document Title Repaints**:
   - [src/ui/widgets/Pomodoro.tsx#L4034](file:///Users/sajid/Developer/personal/tabitat/src/ui/widgets/Pomodoro.tsx#L4034) modifies `document.title` every second via `setInterval`. When multiple dashboard tabs are open in the background, this causes recurring title re-evaluations.
   - **Fix**: Only update `document.title` when `document.visibilityState === "visible"`.

---

### (7) Test Gaps

1. **Missing e2e Test `(l)` in `dashboard.spec.ts`**:
   - [docs/PHASE4.md#L181-L182](file:///Users/sajid/Developer/personal/tabitat/docs/PHASE4.md#L181-L182) acceptance criteria explicitly mandates: `(l) HTML export from the recovery page contains every workspace and link and strips queries when asked`. This test is absent from [tests/e2e/dashboard.spec.ts](file:///Users/sajid/Developer/personal/tabitat/tests/e2e/dashboard.spec.ts).
2. **No e2e Test for Notes Autosave & Conflict Resolution**:
   - No automated test exercises the 500 ms debounce, markdown preview toggle, or the `"Changed elsewhere · Reload / Keep mine"` conflict prompt.
3. **No e2e Test for Customize Panel & Wallpaper Management**:
   - Widget reordering, theme radio buttons, and the IndexedDB wallpaper upload/delete flow have no e2e coverage.
4. **No e2e Test for Backup Banner Lifecycle**:
   - Snoozing for 7 days, turning off the reminder, and triggering the backup download from the banner are untested in browser tests.

---

### (8) Top 10 Concrete Changes Ranked by Priority

1. **Fix window ID resolution on Dashboard new-tab page** ([src/ui/store.ts#L2470](file:///Users/sajid/Developer/personal/tabitat/src/ui/store.ts#L2470)): Resolve window ID via `chrome.tabs.getCurrent()` and remove `windows.onFocusChanged` binding for tab surfaces.
2. **Render `BackupBanner` on Dashboard** ([src/entrypoints/dashboard/App.tsx#L3121](file:///Users/sajid/Developer/personal/tabitat/src/entrypoints/dashboard/App.tsx#L3121)): Mount `BackupBanner` above the widget grid in `App.tsx` and subscribe to `backup:reminder`.
3. **Fix `recordBackup` storage access** ([src/background/backup-reminder.ts#L914](file:///Users/sajid/Developer/personal/tabitat/src/background/backup-reminder.ts#L914)): Call `await repo.remove(BgKeys.backupReminder)` directly instead of probing `repo.store.get`.
4. **Fix Markdown link parenthesis truncation** ([src/core/notes/markdown.ts#L776](file:///Users/sajid/Developer/personal/tabitat/src/core/notes/markdown.ts#L776)): Parse balanced parentheses for link targets in `parseInline`.
5. **Delete orphaned wallpaper blobs in IndexedDB** ([src/entrypoints/dashboard/WallpaperPicker.tsx#L3528](file:///Users/sajid/Developer/personal/tabitat/src/entrypoints/dashboard/WallpaperPicker.tsx#L3528), [src/entrypoints/dashboard/WallpaperPicker.tsx#L3543](file:///Users/sajid/Developer/personal/tabitat/src/entrypoints/dashboard/WallpaperPicker.tsx#L3543)): Call `deleteImage().catch(...)` when switching to a color swatch or gradient.
6. **Fix `BackupBanner` turn-off conflict** ([src/ui/sections/BackupBanner.tsx#L2934](file:///Users/sajid/Developer/personal/tabitat/src/ui/sections/BackupBanner.tsx#L2934)): Remove `?? 0` fallback on `expectedRev` so unpopulated settings do not trigger `checkRev(rev, 0)`.
7. **Scrub tab titles containing query strings in HTML export** ([src/core/export/html.ts#L527](file:///Users/sajid/Developer/personal/tabitat/src/core/export/html.ts#L527)): Apply `stripQueryAndHash` to `title` when `opts.stripQuery` is true and `title` is a URL.
8. **Add missing e2e test `(l)`** ([tests/e2e/dashboard.spec.ts](file:///Users/sajid/Developer/personal/tabitat/tests/e2e/dashboard.spec.ts)): Add Playwright test covering recovery page HTML export and query stripping.
9. **Fix Dashboard wallpaper contrast accessibility** ([src/entrypoints/dashboard/App.tsx#L3097](file:///Users/sajid/Developer/personal/tabitat/src/entrypoints/dashboard/App.tsx#L3097)): Add translucent backdrop card / blur scrim behind clock and header controls.
10. **Add `loading="lazy"` to Quick Links Favicons** ([src/ui/widgets/QuickLinkTile.tsx#L4440](file:///Users/sajid/Developer/personal/tabitat/src/ui/widgets/QuickLinkTile.tsx#L4440)): Prevent batch network flood on new-tab first paint.
