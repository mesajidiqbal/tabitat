**1. Verdict**

**Not ready to tag v1.0.0 yet, even assuming Q1–Q15 pass.** Fix the keyboard-focus defects, resolve the accessibility contrast/modal issues, correct the privacy/listing statements, and replace release contact/repository placeholders first. The manual checklist also omits two tests that the changelog claims it covers.

Validation performed: `npm run typecheck`, `npm run lint` (including core purity), and `npm run i18n` all passed. No builds, Playwright, or unit tests were run. Findings below are verified against source; browser-specific behavior still needs confirmation.

No new onboarding persistence or RPC architecture blocker found: install-only gating is correct, Done uses `send()`, and the handler writes through the serialized global lane (`src/background/onboarding.ts:15`, `src/entrypoints/onboarding/App.tsx:173`, `src/background/handlers.ts:658`). No production UI `chrome.storage` writes were found.

**2. Correctness bugs in Phase 5**

| Severity | Location | Verified scenario and fix |
|---|---|---|
| Medium | `src/ui/components/GridCells.tsx:23`, `src/ui/components/RowActions.tsx:78`, `src/ui/hooks/useRoving.ts:93` | **Actions bypass roving-focus bookkeeping.** Buttons remain `tabIndex=-1`; focusing/clicking one does not update the active row or tracked focused element. Clicking an action in another row leaves the old row as the tab stop; removing that action’s row can leave focus on `body`. Track focus at row/action level and maintain one tab stop at the actual navigation target. |
| Medium | `src/ui/components/WorkspaceRow.tsx:118` | **Completing/cancelling rename loses focus.** Enter/Escape removes the focused input without restoring the primary cell. `useRoving` cannot repair this: it tracks the still-connected primary cell, not the removed input (`useRoving.ts:72`). Restore cell focus after keyboard completion/cancellation; preserve intentional pointer focus on blur. |
| Medium | `src/ui/hooks/useRoving.ts:71` | **Deleting the last row has no focus fallback.** The repair effect immediately returns when count becomes zero; the grid may also unmount. Provide a section-level fallback, such as Add, the section heading, or the adjacent list. |
| Low | `scripts/check-i18n.mjs:244`, `scripts/check-i18n.mjs:462` | **Scalar substitution undercounts are not checked.** A literal scalar argument is classified as `"some"`; a message requiring `$2` therefore accepts `t("key", "one")`. Distinguish known scalar arguments from unknown arrays and check known scalar arity as one. No current broken translation was identified. |

**3. Accessibility**

The structural conversion is substantially correct:

- Lists use labelled `grid` containers, `row`/`gridcell` descendants and one-based indices (`WorkspacesSection.tsx:48`, `TabsSection.tsx:152`, `LinksSection.tsx:149`, `ClosedSection.tsx:37`).
- Group headers span both columns and expose expansion state (`TabGroupHeader.tsx:29`).
- Recently closed correctly reports the full count while showing a prefix (`ClosedSection.tsx:39`).
- Search results retain noninteractive options and an empty status region (`SearchResults.tsx:19`, `ResultRow.tsx:40`).
- Home/End moving between rows is **not inherently wrong**: APG permits first/last-grid-cell behavior for layout grids with fewer than three cells per row. However, End currently targets the last row’s **primary** cell, not its last actions cell. [APG grid pattern](https://www.w3.org/WAI/ARIA/apg/patterns/grid/)

Required fixes beyond §2:

| Issue | Evidence and concrete fix |
|---|---|
| **Multiple action buttons lack a clear cell-interaction model** | `GridCells.tsx:38` uses Right/Left both for moving inside the actions cell and crossing cell boundaries. Adopt either separate cells for actions or an explicit Enter/F2 interaction mode with Escape returning to grid navigation. Document and test that model. |
| **Visual and logical rows diverge on dashboard workspace cards** | `widgets.module.css:334` wraps cards into multiple visual columns, but every card is a logical row (`WorkspacesWidget.tsx:75`). Down can move visually right; Right enters actions instead of the adjacent card. Keep cards vertically stacked or implement geometry-aware rows and navigation. |
| **Confirm dialog is only partially modal** | `src/ui/options/actions.tsx:50` traps Tab between two buttons, but lacks `aria-modal`, background inertness, or protection against focus moving outside through pointer/assistive technology. Use a native modal `<dialog>` with appropriate alert-dialog semantics, or a complete modal implementation. Alternatively make this genuinely nonmodal and remove the trap. Initial focus, Escape, and ordinary return-focus behavior are implemented. |
| **Input boundaries fail the stated contrast target** | `controls.module.css:95` uses `--border-strong` against the same background as its surroundings. Light `#c9cdd4` against white is approximately 1.6:1 (`theme.css:35`); dark is also below 3:1. Use a separate control-border token meeting 3:1. This is not merely decorative where the border identifies the input. |
| **Interaction-state coverage is incomplete** | Axe audits default surfaces, but options tests do not open confirmations (`a11y.spec.ts:221`); the keyboard test covers only a short popup path (`:270`). Add rename completion, pointer-to-action focus, last-row removal, Tab/re-entry, dialog escape attempts, and wrapped dashboard cards. |

Labels generally exist for icon buttons, group toggles, row menus and search. Primary cells expose text but do not announce an explicit “open/switch” control role; consider a native button within each primary cell or localized usage instructions.

Reduced-motion handling appears sound in the inspected styles: transitions/animations are gated by `prefers-reduced-motion: no-preference`. Screen-reader reading order, announcements during dynamic updates, and focus visibility over custom wallpaper remain manual checks—not conclusions established by axe.

**4. Privacy and store compliance**

The following covers the substantive claims in both documents:

| Claim group | Assessment |
|---|---|
| No accounts, developer server, analytics, remote code, host permissions or content scripts; incognito disabled | Matches the inspected manifest and implementation (`wxt.config.ts:39`, `:51`, `:72`). Production CSP matches the quoted policy. Describe it as blocking extension-origin network fetching, not as preventing browser navigation/search/sync. |
| Stored workspaces, tabs, links, notes, todos, sessions, recently closed, settings and operational state | Broadly accurate (`PRIVACY.md:14`). **Trash inventory is incomplete:** replace-import also archives notes and todo lists (`src/core/model/types.ts:174`). |
| Local storage, session caches, IndexedDB wallpaper, per-viewer state/drafts | Matches the documented architecture. The wallpaper exception is legitimate. |
| “Nothing is stored outside your browser profile” / “nothing is sent automatically” | Too absolute alongside optional sync (`PRIVACY.md:36`, `:40`; onboarding message at `messages.json:1886`). Qualify with “by default”; settings sync subsequently operates automatically once enabled. |
| Search, opening pages, downloads, optional settings sync | Disclosed appropriately in `PRIVACY.md:51`. **Store text incorrectly says theme syncs** (`store/README.md:94`): `toSyncPayload()` explicitly removes theme (`src/core/sync/settings.ts:33`). |
| Tabs are the “only sensitive permission” / only permission exposing browsing data | Incorrect (`PRIVACY.md:69`, `store/README.md:72`). Optional bookmarks exposes saved URLs/titles; tab-group titles can also contain sensitive information. Remove exclusivity language. |
| Delete workspace/link, then empty trash | Incomplete deletion guidance (`PRIVACY.md:91`). Purge only updates trash (`handlers.ts:581`); historical URLs can remain in session generations/recently closed. Explain retained historical copies and their retention/deletion paths. |
| Reset settings, remove wallpaper, delete quarantine, uninstall, delete exported files separately | These distinctions are useful and consistent with the intended operations. Do not imply item deletion is comprehensive erasure of historical copies. |
| “Collected categories: none” because processing is local | The rationale at `store/README.md:91` is unsafe. Google explicitly requires disclosure of local-only data handling. Describe browsing activity and user-provided content accurately, then answer the current dashboard’s precise collection questions; local-only processing alone does not justify blanket nondisclosure. [Chrome user-data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq) |
| Single purpose | Tab/workspace management is clear, but “todos, notes and pomodoro … workspace-scoped” is false (`store/README.md:64`). Notes/todos support global scope; pomodoro has one global key/alarm (`src/background/pomodoro.ts:8`). Describe these as supporting focus tools in the same surfaces. |

Permission inventory matches the manifest: nine required permissions plus optional bookmarks; `sessions` is correctly absent. Justifications for tabs, groups, storage, unlimited storage, side panel, alarms and favicons fit their implementation. A reviewer may particularly question `search` and `notifications` as secondary features: retain explicit user-triggered search and timer explanations, without claiming those features are workspace-scoped.

Listing prerequisites:

- Replace `REPO_URL = "https://github.com/"` (`src/ui/options/about.ts:5`).
- Publish a real privacy-policy URL and support URL (`store/README.md:19`, `:99`).
- Replace privacy/security contact placeholders (`PRIVACY.md:101`, `SECURITY.md:7`).
- Dashboard/options screenshots have the documented accepted dimensions. Popup/panel close-ups require composition into accepted canvases, already acknowledged at `store/README.md:58`; this is not a blocker if accepted screenshots are used. [Chrome image requirements](https://developer.chrome.com/docs/webstore/images)
- Remove the broken store-link placeholder until the listing exists; “coming soon” alone is sufficient.

**5. Documentation accuracy**

| Location | Correction |
|---|---|
| `CHANGELOG.md:72` | “All user-facing strings … come from `_locales/en`” is false. Pomodoro notification labels and “finished”/“started” are hardcoded (`src/background/pomodoro.ts:10`, `:61`) and passed unchanged to Chrome (`src/platform/chrome.ts:373`). Localize them; the i18n checker does not detect untranslated prose. This is carried code, newly overstated by Phase 5 documentation. |
| `CHANGELOG.md:88` | Claims real bookmarks permission and drag-and-drop have manual checks. Q1–Q15 contain neither bookmark permission grant/revoke nor dragging a tab onto Saved links. Add both. |
| `CHANGELOG.md:85` | Failed queued edits can be lost on **widget collapse, scope change or removal**, not only page close (`useSyncedRecord.ts:50`, `:158`). Correct the limitation if it remains unfixed. |
| `docs/RELEASE.md:111` | Stale open item says `sessions` is still requested and documented. It has already been removed. Delete this item. |
| `COMPATIBILITY.md:44` | “Tabitat keeps no state in memory” is false: services keep transient state/caches. Say durable recovery does not depend exclusively on worker memory. |
| `docs/MANUAL-QA.md:23` | Expects menu Escape to return to its trigger; Phase 5 explicitly returns to the primary cell (`WorkspaceRow.tsx:145`, `TabRow.tsx:130`). Align expectation with the chosen behavior. |
| `docs/MANUAL-QA.md:3` versus `docs/RELEASE.md:10` | One requires Brave **and** Edge; the other Brave **or** Edge. Choose one release requirement. |
| `README.md:98` | “Sends nothing anywhere” needs the optional-sync/search exceptions already explained in PRIVACY. |

Onboarding correctly explains lost page state, pinned tabs, surfaces, five application commands and both flavors. Excluding `_execute_action` matches the five-command spec and is not a blocker. Repository/contact placeholders are acknowledged customer tasks, but remain release prerequisites.

**6. Release engineering**

**No definite first-v1.0.0 workflow failure found by inspection.**

- Tag parsing strips the leading `v` and compares exactly with package version (`release.yml:27`).
- Package and lockfile both say `1.0.0`; WXT derives manifest version from package metadata.
- Zip source names are correct (`release.yml:51`): installed WXT’s default template uses `{{name}}-{{packageVersion}}-{{browser}}{{modeSuffix}}.zip`.
- Changelog extraction selects the exact bracketed version and rejects missing/empty content (`release.yml:62`).
- `contents: write` supports release creation; asset mismatch checks and prerelease detection are present.

Gaps:

1. **Neither CI nor release runs browser tests** (`ci.yml:18`, `release.yml:36`). Thus the new axe suite is not a release gate. Add installed-Chrome e2e or require recorded results against the exact tagged commit.
2. **Onboarding accessibility silently skips a missing build artifact** (`tests/e2e/a11y.spec.ts:263`). Remove the temporary skip; missing onboarding must fail.
3. **Budgets precede zip rebuilds** (`release.yml:39`). Validate the packaged output/manifest after packaging, or package the already-validated build.
4. Add a release-only placeholder check; current workflows can successfully publish GitHub-homepage links and missing contacts.
5. Verify both extracted manifests’ versions, names, CSP, permissions and new-tab override before publishing. This catches packaging regressions that package-version equality alone cannot.

**7. Residual risk for 1.0**

**Before release:**

- Complete real-browser interruption/recovery, shortcuts, side-panel gestures, NTP window movement and delayed alarms: `docs/MANUAL-QA.md:10`.
- Add and perform bookmark permission grant/denial/revoke plus tab-to-saved-link drag tests. They remain explicitly unverified in `docs/PROGRESS.md:35`.
- Preserve failed todo/quick-link mutations across widget unmounts, or prevent the transition while unresolved. The current hook-local queue makes ordinary collapse/scope changes destructive (`useSyncedRecord.ts:50`, `:158`).
- Resolve focus and input contrast defects above; the earlier grid deferral cannot be considered closed solely by axe passing.
- Complete public repository, privacy/support contacts and private vulnerability reporting setup.

**Reasonable after release, with tracking:**

- Broader Edge/Vivaldi/Opera/Arc coverage beyond the selected release smoke browsers, provided “untested” remains explicit.
- Many-open-NTP search-index memory profiling (`docs/reviews/phase4-triage.md:39`).
- Remaining CLS/performance measurements promised in `phase4-triage.md:37`; do not claim they were completed without recorded results.
- Additional locales and showing Chrome’s `_execute_action` in onboarding.

**8. Top 10 concrete changes, ranked**

1. Repair grid focus tracking for action buttons, rename completion and last-row deletion.
2. Correct privacy/store disclosures: local data handling, sync exceptions, sensitive permissions and deletion retention.
3. Replace repository/contact placeholders and publish working privacy/support/security routes.
4. Preserve failed queued todo/quick-link edits across collapse, scope changes and unmounts.
5. Complete the confirmation dialog’s modality and background focus protection.
6. Raise input-border contrast to 3:1 in both themes.
7. Make grid key behavior and dashboard card geometry consistent; test Tab/re-entry and multi-action cells.
8. Add the missing bookmark/DnD manual checks and enforce browser/a11y evidence for the release commit.
9. Localize pomodoro notifications and strengthen scalar placeholder validation.
10. Correct stale release/compatibility/changelog claims; add packaged-manifest and placeholder checks before publication.