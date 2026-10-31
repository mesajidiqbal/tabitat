# Phase 4 review triage

Reviewers: Codex GPT-6 (`phase4-codex.md`, working tree at `c410c31`;
typecheck + lint green in its sandbox, vitest blocked by EPERM so findings are
code-reading only) and Gemini 3.8 Flash High (`phase4-gemini.md`, bundle
`phase4-bundle.txt` of the same commit; its line numbers are bundle offsets).
Every finding was re-checked against the source before a decision.

Legend: ✅ accepted (fixed in the phase-4 fix pass) · ➖ accepted with a
different fix · ⏭ deferred (tracked) · ❌ rejected.

## Codex findings

| # | Finding | Sev | Decision | Evidence / fix |
|---|---|---|---|---|
| C-B1 | A conflicted note draft lives only in the mounted hook; scope switch / collapse / widget toggle loses it | high | ✅ | Verified (`useNoteDraft` `save()` returns early while `conflictRef` is set; unmount cannot save). Drafts move to a module-level per-scope store that survives unmount, mirrored to `sessionStorage` on change (per-viewer state), restored on mount with the conflict notice intact. |
| C-B2 | After 3 conflict retries or any non-conflict error, pending todo/quick-link ops are dropped and the input is already cleared | high | ✅ | Verified (`useSyncedRecord` catch → `ops.splice`). Failed ops stay queued; the card shows the error with Retry / Discard; the add input keeps its text until the write succeeds. |
| C-B3 | Two surfaces toggling the same todo replay a toggle over the other's result | medium | ✅ | Verified (`toggleTodo` flips current state on replay). Replayed op is `setDone(id, desired)`. |
| C-B4 | Wallpaper blob written before the setting; failures ignored; removal deletes the blob first | medium | ✅ | Verified. Upload: save under a temp key → settings write (checked) → promote temp to `wallpaper` → delete temp; failure leaves the old image. Remove: setting first, then blob. Errors shown. |
| C-B5 | Replacing the image does not refresh other open dashboards (`DOMEvent` is page-local) | medium | ➖ | Verified. Setting value becomes `idb:wallpaper#<ts>` so every page sees a storage change; reads sequenced so an older decode cannot overwrite a newer one. |
| C-B6 | Queued Snooze after "Turn off" writes a record unconditionally; banner shows after expiry | medium | ✅ | Verified (`snoozeBackupReminder` writes without checking settings). Snooze is a no-op when `backupReminderDays === 0` or not due; banner hidden when off. |
| C-B7 | Unmatched `[` rescans the rest of the string: quadratic (2 s at 40k brackets) | medium | ✅ | Verified (`closing(s, i+1, "]")` per `[`). Failed delimiter searches are cached per delimiter ("no closer after index"), making the scan linear; same for `*`/`` ` ``; adversarial test with a time bound. |
| C-B8 | Enter during IME composition triggers search / commits an edit | medium | ✅ | `isComposing` guard in SearchWidget and TodoRow (the add handler already had it). |
| C-B9 | Budgets script ignores unresolved chunk references, misses `?v=` suffixes, matches `from "./x.js"` inside strings | medium | ✅ | Verified. Unresolved local refs fail the run; query/hash stripped; import regex anchored to statement boundaries (minified-safe); tests for each. |
| C-A1 | HTML export headings/folder labels are English constants in core | i18n | ➖ | Core stays pure: `buildHtmlExport` takes a `labels` object; the worker passes `chrome.i18n.getMessage` values with the English defaults as fallback. |
| C-A2 | Widgets are not split per card (one shared barrel) | arch | ❌ | Deliberate: per-widget chunks fragmented the code shared with the popup into many small chunks and pushed the popup over its budget (measured by the implementer); the barrel is one lazy chunk off the first-paint path, which is what §4 requires. |
| C-X1 | Quick-link tiles are all tab stops | a11y | ✅ | Roving tile focus (arrows/Home/End), actions menu reachable from the tile. |
| C-X2 | Pomodoro phase/round changes are not announced | a11y | ✅ | Separate polite status region for transitions; the ticking timer stays `aria-live="off"`. |
| C-X3 | Todo row focus lands on a list item; checkbox out of tab order; shortcuts undiscoverable | a11y | ➖ | The checkbox becomes the roving focus target (`aria-checked` is native), row keys stay; `aria-keyshortcuts` + a visually hidden hint list the keys. |
| C-X4 | Quick-link form Save/Cancel drops focus | a11y | ✅ | Focus returns to the edited tile or the Add button. |
| C-U1 | Dashboard does not mount `BackupBanner` | ux | ✅ | Mounted under the top row (was planned for this pass). |
| C-U2 | Customize lets Clock/Search "move" although they are fixed in the top row | ux | ✅ | Top-row widgets are toggles only; reorder applies to grid cards. |
| C-U3 | Capacity reached by another surface turns an add into a silent no-op | ux | ✅ | With C-B2: the op reports "list full", the draft is kept. |
| C-U4 | Corrupt image accepted on MIME/size alone | ux | ✅ | `createImageBitmap` decode before commit; actionable error. |
| C-P1 | ErrorBanner/ProgressRow loaded via the widget barrel even with every widget off | perf | ✅ | Imported statically (they are small and shared). |
| C-P2 | First paint waits for the full store init | perf | ❌ | Measured painted 18–45 ms on the dashboard (target 50); decoupling would paint widgets late and shift layout. Re-measure in the Phase 5 pass. |
| C-P3 | Fixed 220 px skeletons vs content-height cards | perf | ➖ | Cards get `min-height` equal to the skeleton; CLS measured in Phase 5. |
| C-P4 | Pomodoro ticks every second in hidden dashboards | perf | ✅ | Interval paused while `document.hidden`, refreshed on `visibilitychange`. |
| C-P5 | Each open dashboard keeps its own search index | perf | ⏭ Phase 5 | Index starts on first query only; measure with many NTPs open before changing. |
| C-P6 | Quick-link favicons load eagerly | perf | ✅ | `loading="lazy"`. |
| C-T1 | Missing tests: two-surface edits, retry exhaustion, unmount with drafts, wallpaper failures, off-vs-snooze, adversarial markdown, budgets edge cases, NTP multiwindow, pomodoro hidden/resume | tests | ✅ (partial) | Added with the fixes (DOM + unit); real two-window NTP switching and delayed alarms remain manual (MANUAL-QA). |
| C-S1 | (orchestrator) popup JS 42.7 KB gz over the 40 KB budget after the banner and shared store additions | perf | ✅ | Trimmed to 33.7 KB: widget-only records moved out of `store.ts`, banner export action lazy, and the search engine (fuzzysort + index, ~7.6 KB) now loads right after first paint or on the first keystroke (`searchLoader.ts`); the popup paints first, search is ready within a few ms. `npm run budgets` green for both flavors. |

## Gemini findings

Gemini's bundle did not include the test files or `tests/e2e/export.spec.ts`,
which explains its "missing test (l)" item.

| # | Finding | Sev | Decision | Evidence / fix |
|---|---|---|---|---|
| G1 | Dashboard window id via `windows.getCurrent()` + `onFocusChanged` "breaks new-tab isolation" and can pass `null` to `workspace.switch` | high | ❌ | For a tab page `windows.getCurrent()` is the window that contains the tab (what the spec wants); the focus listener re-resolves the same way, so a dashboard tab keeps its own window. `switchTo` already refuses a `null` window id. |
| G2 | `BackupBanner` Turn off sends `expectedRev: 0` before settings load | medium | ✅ | Verified (`settings?.rev ?? 0`). Button disabled until settings are loaded; no rev-0 fallback. |
| G3 | Markdown link targets end at the first `)`, truncating Wikipedia-style URLs | medium | ✅ | Verified (`indexOf(")")`). Balanced-parenthesis target parsing, still linear. |
| G4 | `recordBackup` probes `repo.store.get` before removing | medium | ➖ | Harmless (typed, same store) but unnecessary: `repo.remove` is idempotent and is called directly now. |
| G5 | Switching from an image to a gradient/color leaves the ≤ 5 MB blob in IndexedDB | medium | ✅ | Verified (only `remove()` deletes). Blob deleted after any settings change away from image (picker, remote change) and on mount when orphaned. |
| G6 | `remove()` deletes the blob before the setting is acknowledged | low | ✅ | = C-B4. |
| G7 | `useSyncedRecord` drops queued ops on non-conflict failure | low | ✅ | = C-B2. |
| G8 | Lazy continuation swallows the paragraph after a list item | low | ❌ | That is CommonMark's lazy continuation rule (a plain line directly after an item continues it; a blank line ends the list), which the renderer follows on purpose. |
| G9 | `BackupBanner` not mounted on the dashboard | spec | ✅ | = C-U1. |
| G10 | e2e (l) missing | tests | ❌ | It exists and passes (`tests/e2e/export.spec.ts`, not in the bundle). |
| G11 | Titles that are URLs keep their query when `stripQuery` is on | privacy | ✅ | Title stripped too when it is a URL. |
| G12 | Contrast on light/dark wallpapers with the opposite theme | a11y | ✅ | Translucent scrim behind the top row when an image/color wallpaper is active; widget cards are opaque already. |
| G13 | Quick-link favicons eager | perf | ✅ | = C-P6. |
