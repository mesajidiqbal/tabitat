# Phase 5 (final) review triage

Reviewers: Gemini 3.8 Flash High (`phase5-gemini.md`, bundle
`phase5-bundle.txt` at `d014335`) and Codex GPT-6 (`phase5-codex.md`; the
first run hit the Codex usage limit mid-review, rerun scheduled 08:04 IST
2026-10-31). Every finding re-checked against the source.

Legend: ✅ accepted (fixed) · ➖ accepted with a different fix · ⏭ deferred /
customer action · ❌ rejected.

## Gemini findings

| # | Finding | Sev | Decision | Evidence / fix |
|---|---|---|---|---|
| G1 | `WorkspaceRow` advertises `1..9` in `aria-keyshortcuts` but its `onKeyDown` ignores digits | high | ❌ | Digits are page-level shortcuts: unhandled keys fall through `useRoving` without `preventDefault` and reach the document listener in `useSurface` (`k >= "1" && k <= "9"` → `switchNth`), so pressing a digit on a focused row switches. Verified by reading both handlers; covered by the existing popup keyboard e2e. |
| G2 | `package.json` is `0.0.1`, so a `v1.0.0` tag fails the release workflow's version assertion | release | ✅ | Intended release step (docs/RELEASE.md), done now: version `1.0.0` (manifest follows). Tagging stays a customer action. |
| G3 | PRIVACY.md lists the `sessions` permission that the manifest no longer declares | privacy | ✅ | Verified (the docs pass predated the manifest change). Row removed; ARCHITECTURE §4 already updated. |
| G4 | Placeholders `<repo-url>`, `<maintainer email>`, `<chrome-web-store-url>` remain | release | ⏭ customer | By design: the repository, contact and store listing do not exist yet; docs/RELEASE.md §7 lists every placeholder. |
| G5 | Workspace row menu lacks `returnFocus` | a11y | ➖ | The menu already returns focus to its trigger (inside the row's actions cell). Changed to return to the row's primary cell, matching TabRow. |
| G6 | Row shortcut keys (`z`, `p`) are case-sensitive, so Caps Lock breaks them | a11y | ✅ | Verified (`a.key === k`). Compare lower-cased, still ignoring Shift/modifier combos. |
| G7 | `TabGroupHeader` single cell in a two-column grid | a11y | ✅ | `aria-colspan="2"` on the header cell. |
| G8 | CHANGELOG lists `/` and `n` among row keys | docs | ✅ | Reworded: they are page-level shortcuts. |
| G9 | Up/Down from the actions cell lands on the next row's primary cell instead of staying in the actions column | a11y | ✅ | APG says vertical arrows keep the column: moving rows from the actions cell focuses the next row's actions cell when it has one, else its primary cell. |
| G10 | Single-purpose statement does not explain notes/todos/pomodoro | store | ✅ | Reworded as workspace-scoped focus tools (per-workspace todos and notes, pomodoro in the same surfaces). |

## Codex findings

Codex GPT-6, read-only sandbox at `59c5449` (typecheck, lint and i18n green there; no builds,
unit or browser tests). Its verdict: not releasable until focus tracking, dialog modality,
input contrast, privacy wording and placeholders are addressed. Numbers are its section.item.

| # | Finding | Sev | Decision | Evidence / fix |
|---|---|---|---|---|
| C2.1 | Focus on an action button bypasses the roving bookkeeping (`onFocus` lives on the primary cell only); a mouse click on another row's action leaves the old row as the tab stop, and removing that row drops focus to `body` | medium | ✅ | Verified: keyboard paths go through `focusAt` (which focuses the primary cell first), but a pointer click on a button does not. `ActionsCell` now reports `focusin` to the row's roving item. |
| C2.2 | Finishing or cancelling a rename loses focus: the input unmounts, the primary cell is still connected so the repair effect does nothing | medium | ✅ | Verified (`WorkspaceRow` `setRenaming(false)` only). Enter/Escape return focus to the primary cell. |
| C2.3 | Deleting the last row leaves focus on `body` (`useRoving` effect returns when `count === 0`) | medium | ✅ | Verified. `useRoving` gets `onEmpty`; each list focuses its section heading / card title (`tabIndex=-1`) or the search box. |
| C2.4 | `check-i18n` counts a scalar substitution as "some", so `t("key", "one")` passes where the message uses `$2` | low | ✅ | Verified (`subsCount` returns "some" for anything but an array literal). String/number/template literals count as 1; identifiers stay "some". No current miss. |
| C3.1 | Home/End go to the first/last row's primary cell (APG: first/last cell of the row) | - | ❌ | Deliberate (PHASE5 §2, UI-SPEC): rows are the unit the user navigates, as in the listbox before it; Ctrl+Home/End would be the grid-wide keys. Documented in UI-SPEC. |
| C3.2 | ArrowRight/Left both move between buttons inside the actions cell and across the cell boundary; APG prefers one cell per control or an Enter/Escape "widget mode" | - | ⏭ | Deliberate simplification: one actions cell per row, Left on the first button returns to the primary cell, and ArrowRight on the last button stops. Documented; revisit if screen-reader feedback asks for it. |
| C3.3 | Dashboard workspace cards are a visual grid but a one-column ARIA grid: Down moves to the visually right card; Right enters the actions instead of the next card | - | ✅ | Verified (`WorkspacesWidget` renders `WorkspaceRow card` in a CSS grid). Card mode navigates in two dimensions (columns computed from the cards' offsets): Left/Right adjacent card, Up/Down the card above/below; the menu opens with Shift+F10 / ContextMenu (already supported, now in the shortcuts). |
| C3.4 | Options confirm is `role="alertdialog"` without `aria-modal` or background inertness, with a Tab trap | - | ➖ | Verified. It is an inline confirmation, not an overlay, so it should not claim to be modal: now `role="group"` labelled by the prompt, focus moves to Cancel, Escape cancels, no Tab trap. |
| C3.5 | Input borders are 1.6:1 (light `#c9cdd4` on white); dark also under 3:1 | - | ✅ | Verified (also Gemini Phase 4, then a design call). New `--border-input` token at ≥ 3:1 on `--bg` in both themes for inputs, selects and textareas; `--border-strong` unchanged for dividers. |
| C3.6 | axe never sees interaction states (confirm open, menu open); keyboard test covers one popup path | - | ✅ partial | Audits added with the row menu open (popup) and the confirm open (options Data); the dashboard card navigation gets a keyboard e2e. |
| C3.7 | Primary cells do not announce as a control ("open"/"switch") | - | ❌ | APG allows a focusable `gridcell` activated with Enter/Space; the row carries `aria-selected`, the cell `aria-keyshortcuts`, and the visually hidden "(active here)" text. A nested button would double the tab/arrow stops. |
| C3.8 | Reading order, announcements and focus visibility over wallpaper need manual checks | - | ➖ | Already Q14 (VoiceOver); focus over wallpaper added to Q14. |
| C4.1 | PRIVACY "Trash" row omits the notes and todo lists archived by a replace import | - | ✅ | Verified (`TrashItem` kinds `note`, `todos`). Row fixed. |
| C4.2 | "Nothing is stored outside your browser profile" / "Nothing is sent automatically" are absolute next to optional sync | - | ✅ | Qualified: "unless you turn settings sync on". |
| C4.3 | store/README says sync carries the theme; `toSyncPayload` drops `theme` | - | ✅ | Verified (`src/core/sync/settings.ts`). Text fixed. |
| C4.4 | "the only permission that exposes browsing data" ignores optional `bookmarks` | - | ✅ | Exclusivity removed in PRIVACY and store/README; bookmarks row says what it exposes. |
| C4.5 | "Delete it, then empty the trash" leaves the URL in session snapshots and recently closed | - | ✅ | Verified (`trash.purge` touches the trash only). Deletion section explains snapshot roll-off (default 10 generations) and the recently-closed list, and how to clear them. |
| C4.6 | "Collected categories: none" is a risky reading of the Web Store form, which asks about data handled, not only transmitted | - | ✅ | Recommended answer changed to disclose "Web history" (tab URLs and titles, stored locally) with the three certifications; the final declaration is the customer's. |
| C4.7 | Single-purpose text calls todos, notes and pomodoro "workspace-scoped"; they also have a global scope and the pomodoro is global | - | ✅ | Reworded. |
| C4.8 | Placeholders (`REPO_URL`, contacts, store link) | - | ⏭ customer | Listed in docs/RELEASE.md §7; now also enforced by a release-workflow step that fails while any placeholder remains. |
| C4.9 | Popup / side panel close-ups are not accepted store sizes | - | ⏭ | Already stated in store/README (compose into 1280×800 or upload the dashboard/options captures only). |
| C4.10 | Permission inventory matches the manifest | - | - | No finding. |
| C5.1 | CHANGELOG says all user-facing strings are localized; pomodoro notification titles are hard-coded English | - | ✅ | Verified (`src/background/pomodoro.ts` `LABEL`). Notification text comes from `chrome.i18n` with the English fallback. |
| C5.2 | CHANGELOG claims manual checks for the real bookmarks permission grant and drag and drop; MANUAL-QA has none | - | ✅ | Q16 (bookmarks permission grant, import, revoke) and Q17 (drag reorder / drag a tab onto Saved links) added. |
| C5.3 | A failed queued todo / quick-link edit is lost on collapse, scope switch or unmount, not only on page close | - | ✅ | Verified (`useSyncedRecord` keeps `ops` and `error` in refs; unmount flushes only when no error is shown). The queue and the error now live in a module-level store keyed by record, like note drafts, so they survive remounts; CHANGELOG limitation reduced to page close. |
| C5.4 | docs/RELEASE.md §8 still says the manifest requests `sessions` | - | ✅ | Verified. Removed. |
| C5.5 | COMPATIBILITY: "keeps no state in memory" is false (caches, in-flight ops) | - | ✅ | Reworded: nothing durable lives only in memory; every record is in storage before the worker may stop. |
| C5.6 | MANUAL-QA Q14 expects Escape to return focus to the menu trigger; Phase 5 returns to the primary cell | - | ✅ | Q14 aligned. |
| C5.7 | "Brave and Edge" (MANUAL-QA) vs "Brave or Edge" (RELEASE) | - | ✅ | Both say: Chrome plus at least one of Brave or Edge; both when available. |
| C5.8 | README "sends nothing anywhere" | - | ✅ | Exceptions named (web search you submit, optional settings sync, downloads). |
| C6.1 | Neither workflow runs the browser suite; the axe suite is not a release gate | - | ⏭ | Deliberate for 1.0 (installed Chrome; ADR in CONTRIBUTING). RELEASE.md now requires the local e2e run (incl. a11y) recorded in the MANUAL-QA results for the release commit. Running e2e on the GitHub runner's Chrome is a post-1.0 item. |
| C6.2 | a11y onboarding test skips silently when `onboarding.html` is missing | - | ✅ | Verified. Skip removed. |
| C6.3 | `npm run budgets` measures the build that `wxt zip` then rebuilds | - | ✅ | Zips first, budgets after, in both workflows, so the packaged output is measured. |
| C6.4 | Release can publish placeholder links / missing contacts | - | ✅ | Placeholder check step in release.yml. |
| C6.5 | Packaged manifests unverified | - | ✅ | release.yml unzips both and asserts version = tag, name keys, the new-tab override only in the newtab zip, no `sessions`. |
| C6.6 | Tag parsing, version match, zip names, changelog extraction | - | - | Checked OK by the reviewer. |

## Notes from the Codex fix pass

- The new axe audit with a row menu open reported `label-content-name-mismatch` on the actions
  cell (its `aria-label` "Actions" did not contain the visible menu items). The cell now names
  itself from its buttons and carries `aria-description` instead.
- Card navigation (C3.3) also applies to the side panel's workspace cards, which share the layout.
- Not fixed, tracked: `TodoRow` and `QuickLinkTile` do not use `ActionsCell`, so a pointer click
  on their buttons still bypasses the roving bookkeeping (the C2.1 gap); keyboard paths and the
  empty-list case are covered.
- `docs/UI-SPEC.md` still described an optional tab-list drag reorder that was never built;
  corrected (the browser owns tab order).
- After the pass: 887 unit tests, 56 e2e (incl. two new interaction-state audits and the card
  keyboard test), budgets green (popup 34.8 KB gz JS).
