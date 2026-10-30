# Phase 3 review triage

Reviewers: Codex GPT-6 (`phase3-codex.md`, read the working tree at `e9129c2`;
typecheck + lint passed in its sandbox, vitest blocked by EPERM so findings are
code-reading only) and Gemini 3.8 Flash High (`phase3-gemini.md`, read the
bundle `phase3-bundle.txt` of the same commit). Every finding was re-checked
against the source before a decision; "Evidence" says what was checked.

Legend: ✅ accepted (fixed in the phase-3 fix pass) · ➖ accepted with a
different fix · ⏭ deferred (tracked) · ❌ rejected.

## Codex findings

| # | Finding | Sev | Decision | Evidence / fix |
|---|---|---|---|---|
| C-B1 | Options drafts send `expectedRev` read at send time, so a remote change between edit and debounce is silently overwritten; queued patches survive a conflict reload | P1 | ✅ | Verified (`SettingsContext.update` reads `rev.current` inside `run`). Each patch captures its base rev when queued; a conflict reload drops the rest of the queue and shows the notice. |
| C-B2 | `updatedAt = now()` can move backwards after a pull from a device with a later clock, so the next local edit loses LWW | P1 | ✅ | Verified (`handlers.ts` settings.update). `updatedAt = max(now, cur.updatedAt + 1)`. |
| C-B3 | Undo reopens every closed duplicate with the current window's workspace as the placeholder `w` hint, including tabs from other windows; vanished source window silently falls back to the current one | P1 | ✅ | Verified (`reopenAsPlaceholders` uses `activeWorkspaceId.peek()` for all). Each tab carries its source window's active workspace (from `store.windowStates`), none when unknown; a missing window reopens in the current window with no `w` hint and the toast says so. |
| C-B4 | Per-folder import infers the common root from populated paths, so an empty selected ancestor shifts the mapping; same-named sibling folders merge | P2 | ➖ | Verified (`bucketsPerFolder` uses `commonRoot(all)`). Contract gains `ImportTarget.root?: string[]` (additive); the picker sends the selected folder's path and the planner buckets relative to it. Same-named sibling folders still merge: Chrome allows them but it is rare and merging is the least surprising result; documented in PHASE3 §6. |
| C-B5 | Raw folder names/titles over the schema limits (200 / 2000 / depth 32) reject the whole import | P2 | ✅ | Verified. UI normalizes before sending (trim names, truncate titles, cap depth with a preview warning); planner trims too. |
| C-B6 | One live window can satisfy several lost generation windows (`.some`), hiding the hint | P2 | ✅ | Verified (`countUnmatchedSessionWindows`). Greedy one-to-one assignment by best Jaccard, workspace ownership also consumed once. |
| C-B7 | A later generation where everything matched does not clear `recovery:hint` | P2 | ✅ | Verified (`session-guard` clears only on ring eviction). On each non-startup generation write, if every window of the hint's generation is now matched (same matcher, one-to-one) the hint is removed; the init snapshot passes `startup: true` and never clears. |
| C-B8 | `tabs.suspend` resolves the window outside the lane; a tab moved between lookups is discarded under the wrong window's lane | P2 | ✅ | Verified. `suspendOne(tabId, expectedWindowId)` re-reads inside the lane and throws `busy` ("tab moved, retry") on mismatch; the handler retries once under the new lane. |
| C-B9 | Whitelist textarea edit followed by section navigation within 300 ms is lost (unmount clears the timer) | P2 | ✅ | Verified. Flush on blur and on unmount. |
| C-B10 | Row action "Never suspend this site" appends past `LIMITS.whitelistHosts`; worker accepts any array length | P2 | ✅ | Verified (`SettingsSchema.suspend.whitelist` is `v.array(v.string())`). Schema caps length and entry length; row action checks and shows a localized limit notice. |
| C-A1 | Import warnings rendered as raw `code:count` | i18n | ✅ | Translated per code with the count. |
| C-A2 | `"Imported"` fallback name hard-coded in UI; options `<title>` hard-coded | i18n | ✅ | Fallback via `t()`; `document.title` set from `t("optTitle")` (the HTML keeps the brand name). |
| C-A3 | `theme` is pushed/pulled although PHASE3 §4 calls it device-specific | arch | ✅ | Verified (`toSyncPayload` keeps `theme`). Excluded from the payload; local theme kept on pull. |
| C-X1 | Inline confirm swaps in an `alertdialog` without moving/restoring focus | a11y | ✅ | Focus moves to the confirm button, Escape cancels, focus returns to the trigger. |
| C-X2 | Row menu trigger is invisible, so menu-only actions are keyboard-only for pointer users | a11y | ✅ | Visible overflow button in the hover action group; right-click on the row opens the same menu. |
| C-X3 | Missing `aria-invalid` / error association on whitelist and workspace-name inputs | a11y | ✅ | Added. |
| C-U1 | About → repository link points at github.com | ux | ⏭ Phase 5 | No repository exists yet; single `REPO_URL` constant set at release. |
| C-U2 | Invalid whitelist lines are dropped while the valid rest autosaves (can remove a host's protection while typing) | ux | ✅ | No autosave while any line is invalid; error names the lines. |
| C-U3 | "Allow suspending this site" on a subdomain removes the parent-domain entry | ux | ➖ | Kept (it is the only way to allow the site) but the toast names the entry removed. |
| C-U4 | Minutes range ignores the spec's step of 5 | ux | ➖ | Spec amended: any value 5–720; step removed from the control. |
| C-U5 | Preview overflow ignores dedupe and per-folder limits | ux | ✅ | Preview runs the core planner (`planBookmarkImport`) against current quick links/workspaces. |
| C-P1 | `duplicateGroups` recomputed on every live-tab refresh | perf | ❌ | One computed shared by count/chips/filter; `findDuplicates` over ≤ a few hundred tabs is sub-millisecond. |
| C-P2 | `FolderTree` recomputes subtree selection per rendered node | perf | ✅ | Selection state computed once per change (map by id). |
| C-P3 | Options sections imported eagerly | perf | ⏭ Phase 4 | Options is a full page opened rarely; measure in the perf gate. |
| C-P4 | Popup bundle growth unmeasured | perf | ✅ | Measured 44.3 KB gz (budget 40): the `t()` fallback bundles the whole en JSON into every surface, now including 104 options keys. Fallback stripped from production builds (define flag; kept for vitest); re-measured after the fix. |
| C-T1 | Missing tests: two-device sync skew/ties, option drafts across remote updates, multi-window undo, per-folder edge cases, one-survivor recovery matching, tab move between suspension lookups, whitelist editor / folder picker DOM tests | tests | ✅ (partial) | Added with the fixes; DOM tests for the whitelist editor and folder picker added (happy-dom is in now). |
| C-T2 | e2e (h) accepts import failure as success | tests | ✅ | Asserts success and the persisted quick links. |

## Gemini findings

Line numbers in `phase3-gemini.md` are offsets into the review bundle, not
source lines. Gemini's bundle did not include the test files, which explains
its "missing tests" items.

| # | Finding | Sev | Decision | Evidence / fix |
|---|---|---|---|---|
| G1 | Selecting folders under different bookmark roots collapses `commonRoot` to empty, so the roots become workspaces | high | ✅ | Real, and the explicit `root` from C-B4 alone would not fix the multi-root case. Rule: one top-most selected folder → `workspacePerFolder` with `root` = its path; several → one `workspace` import per selected folder (all links beneath it). Preview mirrors it; PHASE3 §6 documents it. |
| G2 | `theme` pushed and pulled although device-specific | medium | ✅ | = C-A3. |
| G3 | After a pull applied the remote copy, `afterUpdate`/`syncNow` push the same payload straight back | medium | ✅ | Verified. Push skipped when the local payload equals the remote one after the pull. |
| G4 | `recovery:hint` not cleared when a later generation matches everything | medium | ✅ | = C-B7. |
| G5 | `tabs.suspend` declares no lane in the router, so the queue/busy check is bypassed | medium | ➖ | The handler resolves the window first and then runs under `window:<id>` through `lanes.run` (deliberate: the lane depends on the tab). The remaining gap, a tab moving between the two lookups, is C-B8 (revalidate inside the lane, retry once). Eager busy check kept inside the lane, where it is reliable. |
| G6 | "Allow suspending this site" on a subdomain strips the parent-domain entry | medium | ➖ | = C-U3 (kept, toast names the entry removed). An exact-host-only removal would leave the site still whitelisted by its parent, which is worse. |
| G7 | `p` (park) and drag-to-park bypass the "Already saved" check | medium | ✅ | Verified (`LinksSection.onDrop` and the row action call `tabs.park` directly). UI checks `isSavedLink` on every park path; worker `link.add`/`tabs.park` made idempotent (return the existing link). |
| G8 | Suspending with `z` remounts the row (new tab id) and drops keyboard focus to `body` | a11y | ✅ | Real: `tabs.discard` changes the id, the keyed row unmounts. Focus restored to the same index after the live-tabs refresh. |
| G9 | Translate `code:count` import warnings | i18n | ✅ | = C-A1. |
| G10 | Missing: e2e (g), settings-sync LWW/quota unit tests, planner unit tests, DOM tests | tests | ❌ | They exist (`tests/e2e/ui-popup.spec.ts` (g)/(g2), `src/background/settings-sync.test.ts`, `src/core/sync/settings.test.ts`, `src/core/backup/bookmarks.test.ts`, `src/ui/components/*.dom.test.tsx`); they were not in Gemini's bundle. |
