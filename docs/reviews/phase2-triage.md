# Phase 2 review triage

Reviewers: Gemini 3.8 Flash High (`phase2-gemini.md`, reviewed bundle
`phase2-bundle.txt` at commit `5dea23b`), Codex GPT-6 (`phase2-codex.md`,
reviewed the working tree at `f558514`, same UI code). Every finding below was
re-checked against the source before a decision was made; the "Evidence"
column says what was checked when a finding was rejected.

Legend: ✅ accepted (fixed in the phase-2 fix pass) · ➖ accepted with a
different fix than proposed · ⏭ deferred (tracked) · ❌ rejected.

## Gemini findings

| # | Finding | Sev | Decision | Evidence / fix |
|---|---|---|---|---|
| G1 | `fuzzysort.single` scores are negative, so `score >= 0.3` never matches a workspace | critical | ❌ | fuzzysort **v4** (installed) scores 0..1, 1 = perfect; the v3-and-earlier negative scale no longer applies. Workspace hits are exercised by e2e (d). |
| G2 | Active Unsorted workspace is not in `ws:index`, so it is omitted from `workspaces` | high | ❌ | `context.ts createUnsorted` writes `ws:index: [...index, id]` in the same `setMany`; Unsorted ids are ordinary `newId()` values, not `unsorted:<windowId>`. `tab-tracker` removes it from the index on window close. The computed is correct. |
| G3a | `windows.onRemoved` does not re-resolve `store.windowId` when the current window closes | high | ❌ | Popup and side panel documents are per-window and are destroyed with it; `?window=` pages are pinned on purpose. No live case. |
| G3b | `onFocusChanged` ignores the focused id and calls `windows.getCurrent()` | high | ❌ | Intentional: the side panel must keep showing *its* window, not follow focus; `getCurrent()` is the panel's window. Gemini's fix would make a panel in window A show window B. Listener kept (no-op in panel; popup closes on blur). |
| G4 | `useStorageKey` / `useCorrupt`: stale initial `get()` can clobber a newer `onChanged` value | medium | ✅ | `store.ts start()` already buffers; the two hooks did not. Fixed: once a change for the key is applied, the initial read result is ignored. |
| G5 | Delete offered on Unsorted rows (menu + `Delete` key) | medium | ➖ | Engine handles it (trash + window state reset), but deleting a *live* window's Unsorted is pointless (tracker recreates it). Fixed: Delete hidden for Unsorted rows that are open in a live window (`active || elsewhere`); "Closed window N" Unsorted records stay deletable, users need that. |
| G6 | `op.status` polling at 100 ms has no backoff/cap | medium | ➖ | Chain already stops when no op/pending switch. Added backoff: 100 ms for the first 5 s, then 1 s, and the chain restarts on window change. No hard cap (a long op must still be observed). |
| G7 | `uiError` banner lives inside `WorkspacesSection`, invisible during search | medium | ✅ | Moved to `App.tsx` (popup + panel) under the search box. |
| GA1 | `chrome.tabs.remove` from UI breaks "UI never writes tabs" | arch | ➖ | Kept. Closing a tab is an ordinary browser event the tracker already auto-saves; routing it through RPC adds latency for no consistency gain. `UI-SPEC` clarified: UI may activate/focus/close single tabs; anything that changes *saved* state goes through RPC. |
| GA2 | `openSidePanel` when `windowId` is still null; `s` key gesture | arch | ❌ | Popup renders after `initStore()` (≤150 ms race) and `windowId` resolves in the first awaited batch; `keydown` is a valid transient activation. No reproducible failure. |
| GA3 | Popup can paint `EmptyState` before storage resolves (>150 ms) then shift | arch | ✅ | Lists render nothing until `store.ready`; the empty state only shows once ready. |
| GX1 | Interactive controls nested inside `role="option"` | a11y | ⏭ Phase 5 | Real violation (APG). Correct fix is the grid pattern (`row`/`gridcell`) for workspace/tab/link/closed lists while search results stay a listbox. Structural; done in the Phase 5 a11y pass together with an axe check in e2e. Tracked in PROGRESS. |
| GX2 | `aria-controls` points at an unmounted results list | a11y | ✅ | Set only while results are open. |
| GX3 | `EmptyState` as the direct child of `role="listbox"` | a11y | ✅ | Empty results container is `role="status"`. |
| GX4 | Group header button is a second tab stop outside the roving list | a11y | ✅ | Group headers are roving nodes: arrows reach them, Enter/Space toggles, Tab skips them. |
| GU1 | Other windows' Unsorted cards are all "Unsorted (other window)" | ux | ✅ | Card detail shows the first saved tab titles ("GitHub, Gmail, +9"). |
| GU2 | Undo gives no success feedback | ux | ✅ | "Restored" toast after `trash.restore`. |
| GU3 | Menu wrapper lets Space bubble to the row | ux | ✅ | Space stopped too. |
| GP1 | `liveCount` / `duplicateCount` recomputed on every render | perf | ✅ | Both are computed signals in `store.ts`. |
| GP2 | Search index start bumps `searchVersion` 4× in one frame | perf | ✅ | `start()` runs inside `batch()`. |

## Codex findings

Codex ran `npm run typecheck` and `npm run lint` (both green); `npm test` was
blocked by the sandbox (EPERM on `node_modules/.vite-temp`), so its findings are
code-reading only. Fix pass 2 (after the Gemini pass merged).

| # | Finding | Sev | Decision | Evidence / fix |
|---|---|---|---|---|
| C-B1 | Saved-link draft survives a workspace switch and is saved into the new workspace | medium | ✅ | Verified (`LinkForm` is mounted with `workspaceId={meta.id}`, state survives). Form keyed by workspace id, so a switch resets it. |
| C-B2 | Search unmounts the only `ProgressRow` / error display | medium | ✅ | Same root cause as G7; `ProgressRow` moves to `App.tsx` with the error banner. |
| C-B3 | Initial read vs `onChanged` race in `useStorageKey` / `useCorrupt`; read rejection unhandled | medium | ✅ | = G4, plus rejected reads set `error`. |
| C-B4 | Tab listeners are registered after the initial tab query; overlapping `refreshTabs` responses can go backwards | medium | ✅ | Verified (`subscribe()` is the last line of `start()`). Listeners first; `refreshTabs` carries a sequence number so an older response never overwrites a newer one. |
| C-B5 | Search `selected` is not clamped when hits shrink; ArrowDown on zero hits gives −1 | medium | ✅ | Verified in `useSurface.ts`. Selection clamped against `hits.length`, zero-hit guard, selected row scrolled into view (`block: "nearest"`). |
| C-B6 | `aria-disabled` workspace rows still accept Delete / F2 / menu mutations | medium | ✅ | Verified (`WorkspaceRow.onKeyDown` checks `renaming` only). All mutations gated on `disabled`. |
| C-B7 | Malformed persisted arrays (e.g. `trash.items: [null]`) crash the recovery page | high | ✅ | UI read boundary filters non-object members for trash, recovery entries, generations; each recovery section is wrapped in an error boundary so one bad record cannot blank the page. Quarantine stays a worker job. |
| C-B8 | `ImportSection` dismiss ignores the error envelope | low | ✅ | Envelope checked, localized failure shown. |
| C-A1 | `chrome.tabs.create` from UI (links, closed tabs, search hits, extension pages) | arch | ➖ | Kept, same reasoning as GA1: opening one URL is a plain browser action the tracker auto-saves. Spec wording covers it. |
| C-A2 | Interrupted recovery "Open" uses `windows.create({url: [...]})`, loading every tab | arch | ❌ | Verified false: `Interrupted.incomingUrls` already wraps every restorable tab with `buildPlaceholderUrl` (placeholder-first per ADR-002, `w` hint = destination workspace); only direct-scheme URLs load. The window is a user-initiated open of a frozen entry; the tracker adopts it as Unsorted like any new window. No worker command needed. |
| C-A3 | 150 ms fallback can paint empty sections | arch | ✅ | = GA3. |
| C-A4 | Hard-coded `<title>` in popup/recovery HTML | i18n | ❌ | They are the product name "Tabitat"; brand names are not translated. |
| C-A5 | Import errors / interrupted stage+reason shown untranslated | i18n | ✅ | Envelope codes and stage/reason values mapped through `t()` (raw text kept as detail). |
| C-X1 | Park (and any non-delete row action) unreachable by keyboard | a11y | ✅ | Verified (`TabRow` handles Enter/Space/Delete only). Added `p` for Park and a row action menu on `ContextMenu` / `Shift+F10`, matching `WorkspaceRow`. |
| C-X2 | Focus lost when the focused option is removed | a11y | ✅ | `useRoving` refocuses the clamped index when the count shrinks while focus fell back to `body`. |
| C-X3 | Arrowing through search results does not scroll the active one into view | a11y | ✅ | With C-B5. |
| C-X4 | Interactive descendants inside `role="option"` | a11y | ⏭ Phase 5 | = GX1. |
| C-X5 | `--fg-subtle` ≈ 3.2:1 on white at 11 px | a11y | ✅ | Token darkened to ≥ 4.5:1 in light and dark. |
| C-U1 | "Export" on session snapshots calls `backup.export`, which omits generations | ux | ➖ | Button relabelled "Export backup" now; a generation export is part of the Phase 4 HTML/JSON export work. |
| C-U2 | Recovery banner ignores "latest generation newer than tracked state" | ux | ⏭ Phase 3 | Needs a cheap signal from the worker (it owns generations); tracked. |
| C-U3 | Side-panel cards omit the last-active time | ux | ✅ | Cards show the same saved time as rows. |
| C-U4 | No drag from a tab onto saved links | ux | ⏭ Phase 3 | Implementer note already listed "no drag-and-drop"; DnD lands with duplicate/trash UX in Phase 3. |
| C-U5 | Recently closed truncates with no "Show all" | ux | ✅ | Toggle added. |
| C-P1 | Popup waits for window/tab queries before painting storage data | perf | ❌ | Measured first paint 20–30 ms with the coupled path; decoupling would paint the tab list late and shift layout, which the spec forbids. Re-measure in the Phase 4 perf gate. |
| C-P2 | Every `onUpdated` triggers a full tab + group refresh | perf | ➖ | `onUpdated` ignored unless `changeInfo` touches a field the UI shows; in-flight refreshes sequenced (C-B4). Query cost at the 100-tab cap is ~1 ms, so no per-tab patching yet. |
| C-P3 | Search source scans are whole-collection; `searchVersion.value++` reads reactively | perf | ➖ | `peek()` fix taken; per-workspace change tracking deferred to the Phase 4 profiling pass (collections are capped). |
| C-P4 | Budgets unverified (e2e asserts < 500 ms render, not paint; no gz size check) | perf | ➖ | e2e now asserts the `tabitat:painted` mark < 300 ms (headroom for CI); the size gate is the Phase 4 perf CI item. |
| C-T1 | Missing tests: store buffering / tab events during init / overlapping refresh / malformed records, search incremental index, roving keys, recovery command edge cases | tests | ✅ (partial) | Added with the fixes (fake browser for store, pure helpers for roving/search). DOM-level component tests still need a DOM lib: adopt `happy-dom` at the start of Phase 3. |
| C-T2 | e2e opens `popup.html` as a tab, not the real popup | tests | ❌ | Chrome offers no automation path to the real action popup; lifetime/gesture behavior is covered by `docs/MANUAL-QA.md` Q1–Q3. |
