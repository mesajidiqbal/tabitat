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

_(filled in after the Codex rerun)_
