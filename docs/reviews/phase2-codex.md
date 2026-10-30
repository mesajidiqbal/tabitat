## (1) Verdict

**Do not tag `phase-2` yet.** Direct tab/window creation violates the explicit UI mutation boundary. Keyboard-only parking is unavailable, search hides operation feedback, and read-model/form-state bugs need fixing.

Reviewed the requested source, spec, architecture, and ADR. Findings below are code-verified; browser behavior was not exercised.

- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm test`: blocked before test execution by `EPERM` writing Vite’s temporary config under `node_modules/.vite-temp`.
- No builds or Playwright runs performed.

## (2) Correctness bugs

**B1 — Medium: saved-link drafts silently change destination.**  
[LinksSection.tsx:102](/Users/sajid/Developer/personal/tabitat/src/ui/sections/LinksSection.tsx:102), [LinksSection.tsx:19](/Users/sajid/Developer/personal/tabitat/src/ui/sections/LinksSection.tsx:19). Open Add in workspace A, enter a draft, then switch to B while the form remains mounted. Its URL/title state survives, but `workspaceId` becomes B; submitting saves A’s draft into B. **Fix:** key the form by workspace ID and close/reset it when the active workspace changes, or explicitly pin the draft to its original destination.

**B2 — Medium: search-triggered switches hide progress and errors.**  
[popup/App.tsx:35](/Users/sajid/Developer/personal/tabitat/src/entrypoints/popup/App.tsx:35), [sidepanel/App.tsx:36](/Users/sajid/Developer/personal/tabitat/src/entrypoints/sidepanel/App.tsx:36), [WorkspacesSection.tsx:44](/Users/sajid/Developer/personal/tabitat/src/ui/sections/WorkspacesSection.tsx:44). Searching unmounts the only `ProgressRow` and `uiError` display. Enter on a workspace hit can fail with busy/conflict/limit while the user sees no explanation. **Fix:** render operation status and errors outside the search/sections conditional; guard result actions during operations.

**B3 — Medium: initial storage reads can overwrite newer events.**  
[useStorageKey.ts:45](/Users/sajid/Developer/personal/tabitat/src/ui/hooks/useStorageKey.ts:45), [Quarantine.tsx:17](/Users/sajid/Developer/personal/tabitat/src/entrypoints/recovery/Quarantine.tsx:17). If `onChanged` delivers a newer value before the initial read resolves, the old snapshot replaces it. A newly added generation can disappear or a deleted quarantine record reappear until another event. **Fix:** register listeners first and buffer/replay events, or invalidate initial responses after a relevant event. Handle read rejection too.

**B4 — Medium: live-tab initialization can miss events.**  
[store.ts:246](/Users/sajid/Developer/personal/tabitat/src/ui/store.ts:246), [store.ts:256](/Users/sajid/Developer/personal/tabitat/src/ui/store.ts:256). Initial tab querying completes before listeners are registered. Close/move a tab after that snapshot while the workspace read is still pending: the resulting UI remains stale until another tab event. **Fix:** subscribe before querying and reconcile events received during initialization. Also sequence overlapping `refreshTabs()` responses so older queries cannot overwrite newer results.

**B5 — Medium: result selection becomes invalid after live updates.**  
[useSurface.ts:29](/Users/sajid/Developer/personal/tabitat/src/ui/hooks/useSurface.ts:29), [useSurface.ts:61](/Users/sajid/Developer/personal/tabitat/src/ui/hooks/useSurface.ts:61). Select result 10, then let storage/tab events reduce results to two. `selected` remains 9; Enter does nothing and `aria-activedescendant` references a missing option. ArrowDown with zero hits also sets `selected` to −1. **Fix:** preserve selection by hit key, clamp on result changes, and handle empty results explicitly.

**B6 — Medium: disabled workspace rows still accept destructive shortcuts.**  
[WorkspaceRow.tsx:43](/Users/sajid/Developer/personal/tabitat/src/ui/components/WorkspaceRow.tsx:43). During a switch, `aria-disabled` is true, but Delete still sends `workspace.delete`; F2, opening another window, and recoloring also remain available. Worker serialization does not satisfy the disabled-control contract. **Fix:** gate all mutation handlers on `disabled`, including keyboard handlers and menu entries.

**B7 — High: malformed persisted data can crash the recovery UI itself.**  
[store.ts:123](/Users/sajid/Developer/personal/tabitat/src/ui/store.ts:123), [TrashSection.tsx:29](/Users/sajid/Developer/personal/tabitat/src/entrypoints/recovery/TrashSection.tsx:29), [Sessions.tsx:18](/Users/sajid/Developer/personal/tabitat/src/entrypoints/recovery/Sessions.tsx:18). The UI accepts arrays without validating their members. For example, `trash: {items:[null]}` reaches `describeItem(null)`; a generation containing `windows:[{}]` reaches `w.tabs.length`. These reads bypass repository validation. **Fix:** validate/salvage nested records at the read boundary and isolate damaged sections with an error boundary. Keep quarantine writes in the worker.

**B8 — Low: failed import-dismiss commands disappear silently.**  
[ImportSection.tsx:30](/Users/sajid/Developer/personal/tabitat/src/entrypoints/recovery/ImportSection.tsx:30). The returned error envelope is ignored, so Dismiss appears ineffective when the worker rejects it. **Fix:** inspect the envelope and render a localized failure status.

## (3) Architecture-rule violations

- **Direct tab creation:** [actions.ts:71](/Users/sajid/Developer/personal/tabitat/src/ui/actions.ts:71) and [actions.ts:82](/Users/sajid/Developer/personal/tabitat/src/ui/actions.ts:82) call `chrome.tabs.create` for extension pages, saved links, and recently closed/search results. Add validated worker RPCs.
- **Direct bulk restoration:** [Interrupted.tsx:37](/Users/sajid/Developer/personal/tabitat/src/entrypoints/recovery/Interrupted.tsx:37) calls `chrome.windows.create({url: urls})`. Move recovery restoration into a worker command using the frozen entry.
- **Storage writes:** no direct UI storage mutation found. `sendEnvelope` also uses the same RPC transport; it is not a writer-boundary bypass.
- **Paint stability:** the 150 ms fallback can render empty sections before data arrives, with no reserved tab-list height: [popup/main.tsx:9](/Users/sajid/Developer/personal/tabitat/src/entrypoints/popup/main.tsx:9), [TabsSection.tsx:76](/Users/sajid/Developer/personal/tabitat/src/ui/sections/TabsSection.tsx:76).
- **i18n:** hard-coded document titles remain at [popup/index.html:6](/Users/sajid/Developer/personal/tabitat/src/entrypoints/popup/index.html:6) and [recovery/index.html:6](/Users/sajid/Developer/personal/tabitat/src/entrypoints/recovery/index.html:6). Import errors render raw English messages at [ImportSection.tsx:73](/Users/sajid/Developer/personal/tabitat/src/entrypoints/recovery/ImportSection.tsx:73); interrupted stage/reason values are untranslated at [Interrupted.tsx:61](/Users/sajid/Developer/personal/tabitat/src/entrypoints/recovery/Interrupted.tsx:61). Map user-facing descriptions through `src/i18n`; retain raw details separately.
- **Network:** no runtime fetch/network client found in scope. Production CSP includes `connect-src 'none'`: [wxt.config.ts:7](/Users/sajid/Developer/personal/tabitat/wxt.config.ts:7).

The two additive commands use the global lane correctly: [handlers.ts:445](/Users/sajid/Developer/personal/tabitat/src/background/handlers.ts:445). The purge schema restricts keys to `corrupt:*` and `import:failed`: [schemas.ts:103](/Users/sajid/Developer/personal/tabitat/src/messaging/schemas.ts:103). **No arbitrary-key purge finding.**

## (4) Accessibility issues

- **Park is unreachable by keyboard.** All row action buttons have `tabIndex={-1}`, while row keyboard handling exposes only Open and Delete: [TabRow.tsx:40](/Users/sajid/Developer/personal/tabitat/src/ui/components/TabRow.tsx:40), [TabRow.tsx:101](/Users/sajid/Developer/personal/tabitat/src/ui/components/TabRow.tsx:101). Add an accessible action menu or an explicit keyboard mode for row actions.
- **Focus is lost when the focused option is removed.** `useRoving` adjusts an index but never restores DOM focus after deletion: [useRoving.ts:22](/Users/sajid/Developer/personal/tabitat/src/ui/hooks/useRoving.ts:22). Track item identity and focus the next surviving option or section control.
- **Arrowing through search does not scroll the active result into view.** Selection only changes styling: [ResultRow.tsx:35](/Users/sajid/Developer/personal/tabitat/src/ui/components/ResultRow.tsx:35). Scroll the selected row with `block:"nearest"` while keeping input focus.
- **Options contain interactive descendants.** Workspace options embed menus/rename inputs; tab options embed action buttons: [WorkspaceRow.tsx:62](/Users/sajid/Developer/personal/tabitat/src/ui/components/WorkspaceRow.tsx:62), [TabRow.tsx:63](/Users/sajid/Developer/personal/tabitat/src/ui/components/TabRow.tsx:63). Move controls outside option semantics or use a suitable composite/grid pattern.
- **Secondary text contrast is too low.** `--fg-subtle: #8a909c` on white is approximately 3.2:1, used for 11 px metadata: [theme.css:33](/Users/sajid/Developer/personal/tabitat/src/ui/theme.css:33), [rows.module.css:58](/Users/sajid/Developer/personal/tabitat/src/ui/components/rows.module.css:58). Darken the token to meet 4.5:1.

Visible focus styling and reduced-motion handling are present.

## (5) UX gaps against `docs/UI-SPEC.md`

- **Session export exports different data.** The Session snapshots button calls `backup.export`: [Sessions.tsx:54](/Users/sajid/Developer/personal/tabitat/src/entrypoints/recovery/Sessions.tsx:54). That backup excludes session generations: [core/backup/index.ts:123](/Users/sajid/Developer/personal/tabitat/src/core/backup/index.ts:123). Add generation export; label general backup export separately.
- **Recovery banner omits the “latest generation newer than tracked state” condition.** It checks pending recovery, failed import, and provisional state only: [store.ts:94](/Users/sajid/Developer/personal/tabitat/src/ui/store.ts:94).
- **Side-panel cards omit the requested last-active information.** Time is added only when `!p.card`: [WorkspaceRow.tsx:58](/Users/sajid/Developer/personal/tabitat/src/ui/components/WorkspaceRow.tsx:58). Use an appropriate activity timestamp, not an inaccurately labeled save timestamp.
- **Saved-link drag from tabs is absent.** Neither [TabsSection.tsx:51](/Users/sajid/Developer/personal/tabitat/src/ui/sections/TabsSection.tsx:51) nor [LinksSection.tsx:85](/Users/sajid/Developer/personal/tabitat/src/ui/sections/LinksSection.tsx:85) supplies drag/drop handlers. The spec explicitly defers reorder, but not this interaction.
- **Recently closed entries are truncated without an expansion control.** Popup shows five, panel 25, followed only by “and more”: [ClosedSection.tsx:16](/Users/sajid/Developer/personal/tabitat/src/ui/sections/ClosedSection.tsx:16). Add Show all.

## (6) Performance concerns

- **Popup waits for browser APIs before painting storage data.** Startup awaits window discovery, workspace reads, and live tab/group queries: [store.ts:235](/Users/sajid/Developer/personal/tabitat/src/ui/store.ts:235). Separate storage readiness from live-browser hydration; reserve layout before the latter completes.
- **Full tab refresh on every update burst.** Every `onUpdated` schedules both tab and group queries, then replaces both collections: [store.ts:154](/Users/sajid/Developer/personal/tabitat/src/ui/store.ts:154), [store.ts:263](/Users/sajid/Developer/personal/tabitat/src/ui/store.ts:263). Filter irrelevant changes, update individual tabs where possible, and coalesce in-flight refreshes. Continuous events can also postpone the trailing debounce indefinitely.
- **Search indexing is incremental, but source scans are broad.** Any workspace-tab change scans every saved tab; any metadata change scans every saved link: [search.ts:75](/Users/sajid/Developer/personal/tabitat/src/ui/search.ts:75), [search.ts:90](/Users/sajid/Developer/personal/tabitat/src/ui/search.ts:90). Track changed workspace sources separately. Use `peek()` for the version increment at line 49 to avoid incidental reactive dependencies.
- **Budgets remain unverified.** The smoke test asserts render time below 500 ms, not visible-workspace paint below 100 ms or layout stability: [ui-popup.spec.ts:119](/Users/sajid/Developer/personal/tabitat/tests/e2e/ui-popup.spec.ts:119). Bundle gzip size was not measured.

The fuzzysort `>= 0.3` threshold is correct. The document index is not rebuilt per keystroke.

## (7) Test gaps

| Area | Highest-value missing coverage |
|---|---|
| `store.ts` | Buffered startup writes/removals; tab events during initialization; overlapping refresh responses; failed reads; malformed records; operation polling start/stop; per-window ownership. |
| `search.ts` | Incremental add/update/remove; active-workspace exclusion; ordinary-ID Unsorted workspaces; escaped highlights; stale selection; workspace switching versus focusing an existing owner. |
| `tabs.ts` | Existing four tests cover basics. Add nonempty browser titles on placeholders, old URL plus new pending URL, missing group metadata, and duplicate parity across active/audible/discarded cases. |
| `useRoving` | Exactly one tab stop; Home/End/arrows; nested-control exclusion; reorder/removal/collapse; actual focus recovery after deletion. |
| Recovery commands | Dismiss subset/all/unknown IDs; concurrent append serialization; forbidden purge keys; duplicate keys; omitted keys preserving `import:failed`. |
| UI integration | Keyboard Park; switch from search with progress/failure; link draft across workspace change; corrupt recovery records; undo success/failure. |

The E2E suite opens `popup.html` as a normal tab: [ui-popup.spec.ts:2](/Users/sajid/Developer/personal/tabitat/tests/e2e/ui-popup.spec.ts:2). It therefore does not verify actual popup closure/lifetime or side-panel user-gesture behavior. Add real-popup and per-window side-panel coverage.

RPC retry coverage already exists in [rpc.test.ts:20](/Users/sajid/Developer/personal/tabitat/src/messaging/rpc.test.ts:20); retain it.

## (8) Top 10 concrete changes ranked by priority

1. Move URL/page creation and interrupted recovery restoration into validated worker RPCs.
2. Validate nested storage records and keep recovery usable when one record is corrupt.
3. Make Park and all row actions keyboard-accessible.
4. Fix initial-read/event races and overlapping tab refresh responses.
5. Keep progress/errors visible during search; consistently disable mutation actions.
6. Bind saved-link drafts to a workspace identity.
7. Preserve search selection by key, clamp it, and scroll selected results into view.
8. Restore focus after row deletion, collapse, and inline-form closure.
9. Decouple storage-first rendering from browser hydration; reserve layout and measure actual paint/shift.
10. Add the focused unit/integration tests above, plus real-popup and side-panel E2E coverage before tagging.