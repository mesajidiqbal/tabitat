## (1) Verdict

**Do not tag `phase-3` yet.** Settings conflict handling, sync ordering, undo metadata, bookmark grouping, and recovery hints have correctness gaps.

Validation: **typecheck and lint passed**. Vitest could not start because the sandbox denied writing `node_modules/.vite-temp` (`EPERM`); tests were reviewed by reading. No builds or Playwright were run. No files were changed.

Severity below: **P1** = potential lost edits/wrong recovery association; **P2** = functional defect; **P3** = polish.

## (2) Correctness bugs

| # | Severity / source | Concrete failure and fix |
|---|---|---|
| B1 | **P1** — [SettingsContext.tsx:62](/Users/sajid/Developer/personal/tabitat/src/ui/options/SettingsContext.tsx:62), [SettingsContext.tsx:83](/Users/sajid/Developer/personal/tabitat/src/ui/options/SettingsContext.tsx:83) | **Stale drafts bypass `expectedRev`.** Start editing the whitelist; another device changes it before the debounce fires. The provider adopts the new revision, then submits the old draft with that revision, silently overwriting the remote edit. Queued patches also survive a conflict reload. Capture the draft’s base revision; advance revisions only for acknowledged writes from that queue, and invalidate pending patches on conflict. |
| B2 | **P1** — [handlers.ts:343](/Users/sajid/Developer/personal/tabitat/src/background/handlers.ts:343) | **Local updates can move sync time backward.** After pulling timestamp `2000`, a device whose clock reads `1000` edits settings and pushes timestamp `1000`. The other device ignores it as older; local and remote settings diverge. Generate `updatedAt = max(now, previousUpdatedAt + 1)`. This also prevents consecutive local writes sharing one timestamp. |
| B3 | **P1** — [tabActions.ts:30](/Users/sajid/Developer/personal/tabitat/src/ui/tabActions.ts:30) | **Undo gives every reopened tab the current UI workspace’s `w`.** Close duplicates across windows A/B, then undo from A: B’s placeholders identify A. Placeholder workspace hints influence restart matching. Capture each tab’s source workspace when closing; resolve the actual destination before creating its placeholder. The catch-all fallback also silently opens tabs in the current window if the source window vanished—make that fallback explicit and avoid carrying a false workspace hint. |
| B4 | **P2** — [bookmarks.ts:83](/Users/sajid/Developer/personal/tabitat/src/core/backup/bookmarks.ts:83) | **Per-folder mapping loses selection boundaries and folder identity.** Select `Dev`, containing no direct links and only `Docs/Deep` links: the inferred common root becomes `Deep`, rather than preserving `Dev`’s direct-child destination `Docs`. Same-named sibling folders also collapse because buckets use names. Carry selected-root boundaries and stable folder IDs through the import contract; do not infer them from populated link paths. |
| B5 | **P2** — [bookmarks-tree.ts:153](/Users/sajid/Developer/personal/tabitat/src/ui/options/bookmarks-tree.ts:153), [schemas.ts:94](/Users/sajid/Developer/personal/tabitat/src/messaging/schemas.ts:94) | **One long bookmark name rejects the whole import.** The picker sends raw folder paths/titles, while RPC rejects folder names over 200 characters, titles over 2000, or paths over 32 components. The planner’s name trimming never runs. Normalize display names/titles before submission and handle excessive depth explicitly, with preview warnings rather than an unexplained batch failure. |
| B6 | **P2** — [matcher.ts:176](/Users/sajid/Developer/personal/tabitat/src/core/reconcile/matcher.ts:176) | **One live window can satisfy multiple lost session windows.** Two prior windows contain identical URLs; only one returns. Both pass `.some(...)`, so no recovery hint appears. Match session windows to live windows one-to-one, including workspace-based matches. |
| B7 | **P2** — [session-guard.ts:106](/Users/sajid/Developer/personal/tabitat/src/background/session-guard.ts:106) | **A newly matched generation does not clear the hint.** A delayed browser restore completes and a fresh snapshot is written, but the banner remains until dismissal, explicit restore, another browser restart, or ring eviction. Implement the spec’s matched-generation clearing condition. Coordinate this with startup snapshotting so an immediate survivor-only snapshot does not erase a useful warning. |
| B8 | **P2** — [handlers.ts:235](/Users/sajid/Developer/personal/tabitat/src/background/handlers.ts:235), [suspender.ts:76](/Users/sajid/Developer/personal/tabitat/src/background/suspender.ts:76) | **Suspension can execute under the wrong window lane.** A tab moves from A to B between the first lookup and the lookup inside A’s lane. `suspendOne` uses B but still holds A’s lane; B can begin a switch after the lock check. Pass the expected window ID, verify it inside the lane, and release/re-resolve on mismatch. |
| B9 | **P2** — [WhitelistEditor.tsx:27](/Users/sajid/Developer/personal/tabitat/src/ui/options/WhitelistEditor.tsx:27) | **Navigation silently drops a valid whitelist edit.** Edit the textarea and click another options section within 300 ms: unmount cancels the timer, and there is no blur flush. Flush valid drafts on blur/navigation or keep pending commits in the provider. |
| B10 | **P2** — [tabActions.ts:137](/Users/sajid/Developer/personal/tabitat/src/ui/tabActions.ts:137), [schemas.ts:334](/Users/sajid/Developer/personal/tabitat/src/core/model/schemas.ts:334) | **The whitelist limit is bypassed by row actions.** With 200 entries, “Never suspend this site” appends a 201st; the worker accepts an unbounded string array. Enforce the limit in the worker’s update validation and surface a localized limit notice. |

Verified safeguards: pulls retain remote timestamps and do not push, so the ordinary two-device echo does **not** create a bounce loop. Invalid remote records preserve local settings; partial records receive schema defaults. Quota failures retain local settings without automatic retry loops. Discard replacement IDs are handled by tracker/UI replacement listeners. Bookmark destinations are persisted together through `setMany`, with destination-level dedupe and caps.

## (3) Architecture/privacy-rule violations

- **i18n violation:** [BookmarksSection.tsx:174](/Users/sajid/Developer/personal/tabitat/src/ui/options/BookmarksSection.tsx:174) renders worker codes such as `duplicates:2` and `quicklinks_limit:3` directly. Translate code/count pairs.
- **Hard-coded user-facing text:** [bookmarks-tree.ts:182](/Users/sajid/Developer/personal/tabitat/src/ui/options/bookmarks-tree.ts:182) supplies `"Imported"`; [options/index.html:7](/Users/sajid/Developer/personal/tabitat/src/entrypoints/options/index.html:7) retains `"Tabitat options"` as its document title. Localize the UI fallback and page title.
- **Device-specific theme contract violated:** [core/sync/settings.ts:22](/Users/sajid/Developer/personal/tabitat/src/core/sync/settings.ts:22) pushes `theme`, and line 56 replaces it on pull. PHASE3 §4 calls theme device-specific. Exclude it and preserve local theme, or explicitly amend that requirement.

**No tab/note/todo leakage into sync found.** No production UI storage writes, core browser access, or added network calls found. Production CSP retains `connect-src 'none'`. The import gesture requests only optional `bookmarks`; no additional permissions are needed.

## (4) Accessibility issues

- **P2 — confirmation focus:** [actions.tsx:28](/Users/sajid/Developer/personal/tabitat/src/ui/options/actions.tsx:28) replaces the focused button with an `alertdialog` but neither moves focus into it nor restores focus afterward. Implement a proper dialog with description, initial focus, Escape and restoration; alternatively use an inline confirmation group with explicit focus management.
- **P2 — inaccessible menu-only action for pointer users:** [RowActions.tsx:64](/Users/sajid/Developer/personal/tabitat/src/ui/components/RowActions.tsx:64) uses an invisible trigger; [rows.module.css:111](/Users/sajid/Developer/personal/tabitat/src/ui/components/rows.module.css:111) makes it 1 px and transparent. There is no row context-menu handler. “Never suspend this site” is effectively keyboard-only. Add a visible overflow button and optionally handle right-click.
- **P3 — validation associations:** [WhitelistEditor.tsx:48](/Users/sajid/Developer/personal/tabitat/src/ui/options/WhitelistEditor.tsx:48) lacks `aria-invalid`; [ImportDestination.tsx:56](/Users/sajid/Developer/personal/tabitat/src/ui/options/ImportDestination.tsx:56) does not associate its required-name error with the input. Add those attributes.
- The duplicate filter has `aria-pressed`; chips contain readable text. The drop zone has the existing `p` keyboard equivalent. No separate blocker found there. The tracked interactive-controls-inside-options issue is intentionally excluded.

## (5) UX gaps against PHASE3.md

- [AboutSection.tsx:7](/Users/sajid/Developer/personal/tabitat/src/ui/options/AboutSection.tsx:7): repository link points to the GitHub homepage.
- [WhitelistEditor.tsx:33](/Users/sajid/Developer/personal/tabitat/src/ui/options/WhitelistEditor.tsx:33): invalid lines are omitted while the remaining list autosaves. Temporarily making an existing host invalid can remove its protection. Preserve the last valid list while errors exist, or clearly explain partial saving.
- [tabActions.ts:134](/Users/sajid/Developer/personal/tabitat/src/ui/tabActions.ts:134): “Allow suspending this site” on a subdomain removes its parent-domain exemption, affecting sibling sites too. Show the actual scope being removed.
- [fields.tsx:99](/Users/sajid/Developer/personal/tabitat/src/ui/options/fields.tsx:99): range checks ignore the suspension field’s step of five; typed `7` is saved despite native step invalidity. Enforce the intended step or change the control contract.
- [bookmarks-tree.ts:188](/Users/sajid/Developer/personal/tabitat/src/ui/options/bookmarks-tree.ts:188): preview overflow is capacity-only; it ignores duplicates and per-folder limits. Reuse the import planner for an accurate preview.

## (6) Performance concerns

- **Duplicates:** [store.ts:131](/Users/sajid/Developer/personal/tabitat/src/ui/store.ts:131) shares one computed grouping across count/chips/filter—good. However, every full live-tab refresh invalidates it, including title/favicon changes. Profile large windows before introducing field-aware caching.
- **Bookmark tree:** [FolderTree.tsx:16](/Users/sajid/Developer/personal/tabitat/src/ui/options/FolderTree.tsx:16) recursively calculates selection state for each rendered folder; deep expanded trees repeat subtree traversal. Compute states once per selection change.
- **Options loading:** [sections.ts:4](/Users/sajid/Developer/personal/tabitat/src/ui/options/sections.ts:4) eagerly imports every section, although only one renders. Lazy-loading bookmarks/data would reduce initial parsing.
- **Popup growth:** the new actions reuse core URL/suspension helpers; no obvious large new runtime dependency entered this path. Actual bundle growth remains **unmeasured**, since builds were prohibited.

## (7) Test gaps

Highest-risk missing coverage:

- Two-device sync with clock skew, equal timestamps, partial payloads, and a local edit immediately after a pull.
- Options drafts spanning remote updates, queued conflicts, failed saves and navigation before debounce.
- Undo across multiple windows, workspace switches during the toast, missing source windows, and assertions on placeholder `w`/`s`, not only `u`.
- Per-folder imports with empty selected ancestors, same-named sibling folders, long names and deep paths.
- Recovery matching with two similar windows and only one survivor; clearing after delayed restoration.
- Tab movement between suspension lookups and concurrent destination-window operations.
- Required whitelist-editor and folder-picker **DOM tests** are absent; pure helper tests do not exercise focus, timers or event handling.
- [options.spec.ts:193](/Users/sajid/Developer/personal/tabitat/tests/e2e/options.spec.ts:193) explicitly accepts import failure as success. Require successful import and verify persisted quick links for acceptance case (h).

## (8) Top 10 concrete changes ranked by priority

1. Preserve draft revisions and invalidate queued writes on conflict — **B1**.
2. Make local sync timestamps monotonically increasing — **B2**.
3. Capture per-tab workspace metadata and define missing-window undo behavior — **B3**.
4. Carry stable folder identities and selected-root boundaries into imports — **B4**.
5. Make recovery matching one-to-one — **B6**.
6. Implement matched-generation hint clearing without premature startup clearing — **B7**.
7. Revalidate suspension’s window ownership inside its lane — **B8**.
8. Fix whitelist debounce loss and enforce its limit in the worker — **B9/B10**.
9. Normalize oversized bookmark metadata and make import acceptance tests require success — **B5**.
10. Complete the release polish pass: confirmation focus, visible row menu, translated warnings, device-local theme and repository URL.