## 1. Verdict

**Do not tag `phase-4` yet.** Draft loss, incorrect concurrent todo updates, wallpaper consistency failures, and an easily triggered markdown freeze need fixes.

Validation: **typecheck and lint passed**. Vitest failed before running tests: sandbox `EPERM` writing `node_modules/.vite-temp`. Tests were reviewed by reading. No builds or Playwright were run.

## 2. Correctness bugs

| Severity | Source | Concrete failure and fix |
|---|---|---|
| **High** | `src/ui/widgets/useNoteDraft.ts:57,106`; `Notes.tsx:40`; `src/entrypoints/sidepanel/PanelWidgets.tsx:71` | **Conflicted drafts disappear on unmount.** After a conflict, switch scope, collapse Notes, or disable the widget. The draft exists only in the unmounted hook; cleanup cannot save it because `conflictRef` blocks saving. Returning shows stored text. Keep drafts in a per-scope controller outside the component; persist recovery drafts through worker RPC to storage.local when needed. |
| **High** | `src/ui/widgets/useSyncedRecord.ts:78`; `Todos.tsx:74`; `QuickLinksGrid.tsx:86` | **Failed writes discard user input.** After three conflict retries, or a quota/worker error, pending operations are removed. Todo input has already been cleared and the quick-link form closed. Preserve failed operations and form values with explicit Retry/Discard actions. |
| **Medium** | `src/ui/widgets/Todos.tsx:103`; `todos-logic.ts:30` | **Two surfaces checking the same task can leave it unchecked.** Both start from `done=false`; the second write conflicts and replays a toggle over `done=true`. Capture the intended checked value and replay an idempotent `setDone(id, desired)` operation. |
| **Medium** | `src/entrypoints/dashboard/WallpaperPicker.tsx:30,43`; `settings.ts:66` | **Blob and settings updates can disagree.** Upload overwrites the blob before settings succeeds; removal deletes it first. `updateSettings()` returns `false` on failure, which both callers ignore. A settings conflict can destroy the previous image or leave an image setting without a blob. Serialize wallpaper operations, check the result, preserve rollback data, and report deletion/quota failures. |
| **Medium** | `src/entrypoints/dashboard/App.tsx:43,54,60`; `WallpaperPicker.tsx:33` | **Replacing an image does not refresh other open dashboards.** Their dependency remains `isImage=true`, and the custom event reaches only the uploading document. Broadcast an invalidation across extension pages and sequence reads so older results cannot replace newer images. |
| **Medium** | `src/background/backup-reminder.ts:35`; `src/ui/sections/BackupBanner.tsx:38` | **A stale Snooze action recreates a disabled reminder.** Surface A turns reminders off; a previously queued Snooze from B runs afterward and writes a record unconditionally. The alarm remains disabled, but reopening after snooze expiry displays the banner. Recheck cadence/due state inside snooze; also suppress the banner when settings say off. |
| **Medium** | `src/core/notes/markdown.ts:120` | **Unmatched brackets cause quadratic parsing.** Every `[` scans the remaining string for `]`. Direct measurements: 10k brackets ≈106 ms; 20k ≈390 ms; 40k ≈2,054 ms. Preview blocks the UI. Use a linear tokenizer or cache failed delimiter searches; add adversarial input tests. |
| **Medium** | `src/ui/widgets/SearchWidget.tsx:53`; `TodoRow.tsx:104` | **IME confirmation can activate search or commit an edit.** Enter handlers do not check `isComposing`; confirming Japanese/Chinese input can navigate away or prematurely finish editing. Ignore composition key events, as the todo-add handler already does. |
| **Medium** | `scripts/check-budgets.mjs:90,106,121` | **The budget graph silently undercounts unresolved dependencies.** Missing referenced chunks are ignored; static imports ending in `.js?v=1` are missed. The regex also treats `from "./unused.js"` inside strings as an import. Verified the latter two directly. Parse module syntax and fail on unresolved local references. |

**Checks with no confirmed defect:** HTML text/attribute escaping, dangerous-scheme rejection, placeholder unwrapping, query/fragment removal, and generation folders/filenames are consistent with the implementation contract (`src/core/export/html.ts:65,72,135`). Notes render text nodes and allow only absolute HTTP(S) links; no HTML or image injection found.

Normal reminder install, cadence change, export, snooze expiry and restart paths are present. The dashboard uses `chrome.windows.getCurrent()` through `src/ui/store.ts:237`; I found no confirmed wrong-window targeting bug.

## 3. Architecture/privacy-rule violations

- **Localization:** `src/core/export/html.ts:149,162,169,180,191` hardcodes English export headings and folder labels. Pass translated labels into the pure exporter from the worker; keep Netscape syntax unchanged.
- **Per-card splitting is not implemented:** `src/entrypoints/dashboard/App.tsx:25` and `src/entrypoints/sidepanel/PanelWidgets.tsx:22` dynamically import the same widget barrel. Its static exports pull all widget implementations together.
- No UI `chrome.storage` mutations were found in the reviewed additions. Canonical writes use RPC; wallpaper IndexedDB writes fit the documented exception.
- No new automatic exfiltration path was found. Sync projects settings only, image wallpaper is excluded, notes contain no remote images, and production CSP retains `connect-src 'none'` (`wxt.config.ts:7`). Explicit web search is the specified user-triggered exception.

## 4. Accessibility issues

- **Quick links lack roving focus:** `QuickLinksGrid.tsx:100`, `QuickLinkTile.tsx:63`. Every tile and menu trigger becomes a Tab stop. Add roving tile focus with arrow/Home/End navigation and a keyboard-accessible actions menu.
- **Pomodoro transitions are silent:** `Pomodoro.tsx:58`. Keeping the second-by-second timer `aria-live="off"` is correct, but phase/round/start/stop changes need a separate polite status region.
- **Todo interaction is undiscoverable:** `TodoRow.tsx:64,87`. Focus lands on a list item while its checkbox is excluded from tab order; F2/Delete/Alt+arrows lack associated instructions. Provide semantic checked state on the focused control and accessible shortcut help.
- **Quick-link form dismissal loses focus:** `QuickLinksGrid.tsx:84,91`. Save/Cancel removes the focused form without restoring focus. Return focus to the edited tile or Add button.
- Customize has labeled controls, Escape handling and focus restoration. Reordering has keyboard equivalents; no drag-only blocker found.
- Clock/cards have substantial background backing, so wallpaper alone does not establish a contrast failure. Verify composited muted text and focus indicators against black/white images; use opaque surfaces where contrast fails (`widgets.module.css:8`, `dashboard.module.css:32`).

## 5. UX gaps against `docs/PHASE4.md`

- **Dashboard backup banner is missing:** `src/entrypoints/dashboard/App.tsx:103`. Mount `BackupBanner` as required by §3.
- **Customize offers ineffective moves:** `Customize.tsx:88`; `App.tsx:93`; `src/ui/widgets/order.ts:29`. Clock/Search can move in the settings list, but remain fixed above the grid. Separate top-row controls from reorderable cards or honor the displayed order.
- **Concurrent capacity changes silently drop additions:** `todos-logic.ts:26`, `quicklinks-logic.ts:51`. If another surface fills the list before replay, add becomes a successful no-op after the input/form was cleared. Preserve the draft and display “list full.”
- Missing wallpaper blobs fall back reasonably, but corrupt image data is accepted solely from MIME/size checks (`WallpaperPicker.tsx:26`). Decode before committing and show an actionable error.

## 6. Performance concerns

- **Widget loading is unconditional:** even with every widget disabled, `App.tsx:103` mounts lazy ErrorBanner/ProgressRow from the same widget barrel. Import individual components and load action feedback independently.
- **First paint waits on excessive initialization:** `dashboard/main.tsx:8` races the entire store against 150 ms; `src/ui/store.ts:332` loads all workspace records and queries tabs/groups before completing. Separate shell/settings readiness from the full read model.
- Wallpaper reads are deferred and not awaited by rendering. Actual first-paint timing remains unverified here.
- Fixed 220 px skeletons do not guarantee stable layout: resolved cards have content-dependent heights (`widgets.module.css:51`). Reserve appropriate dimensions or measure layout shift.
- Pomodoro derives remaining time from `endsAt`, avoiding accumulated interval drift; title restoration cleanup is present (`Pomodoro.tsx:36,40`). Hidden dashboards still tick every second. Pause hidden-view rendering and refresh on visibility changes.
- Search indexing starts only on the first nonempty query (`src/ui/search.ts:163`), which is good. Each dashboard then retains its own index/subscriptions; measure many simultaneously open new tabs.
- Favicons use the local endpoint, but all quick-link images load eagerly (`QuickLinkTile.tsx:77`). Lazy-load offscreen tiles.

## 7. Test gaps

Highest-risk missing coverage:

- Two actual surfaces editing the same todo, note and quick-link record, including storage events arriving before RPC acknowledgments.
- Conflict/retry exhaustion, quota failures, scope changes and collapse/unmount with unsaved drafts. Existing Notes DOM tests resolve conflicts while mounted.
- Wallpaper settings rejection, deletion failure, concurrent uploads, malformed images and cross-page invalidation.
- Off-versus-snooze interleaving; stale banner actions after export.
- Adversarial markdown runtime and large-note preview responsiveness.
- Budget missing references, query-bearing imports, comments/strings and graph cycles.
- Multiwindow new-tab workspace switching and moving a dashboard tab between windows.
- Pomodoro delayed alarms, hidden-tab resume, widget removal/title restoration, and transition announcements.

The existing export tests cover escaping, unsafe URLs, stripping, placeholders and generation structure. Reminder tests cover ordinary lifecycle cases; those should not be described as wholly untested.

## 8. Top 10 concrete changes, ranked

1. Preserve note drafts across conflict and component unmount.
2. Retain failed todo/quick-link edits with Retry/Discard.
3. Replace replayed todo toggles with explicit desired-state writes.
4. Make wallpaper updates rollback-safe and propagate invalidation across pages.
5. Remove quadratic markdown delimiter scanning.
6. Guard Snooze against disabled/not-due reminders.
7. Mount the dashboard backup banner.
8. Split widget imports individually and decouple first paint from full store initialization.
9. Fix IME handling, quick-link roving focus, form focus restoration and Pomodoro announcements.
10. Make budget graph parsing reliable and unresolved references fatal.