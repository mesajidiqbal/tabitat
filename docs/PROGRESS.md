# Tabitat — progress & resume checkpoint

This file is the single place to look when resuming work after a pause.
Update it at the end of every phase (and at any forced pause).

## Current checkpoint

- Phase: **4 done**, tagged `phase-4` (2026-10-31, ~06:15 IST).
- State: dashboard page (also the NTP in the newtab flavor) with Clock,
  Search (universal + web search), Quick links grid, Workspaces, Todos,
  Notes (pure linear markdown renderer), Pomodoro, Customize (toggles,
  order, theme, wallpaper incl. IndexedDB image with rollback-safe
  replace); side panel Todos/Notes/Pomodoro; Netscape-bookmark HTML
  export (all data or one generation, strip-query option, localized
  labels); backup reminder (daily alarm, snooze/off guards, banner on
  popup/options/dashboard); perf budgets gate in CI
  (`scripts/check-budgets.mjs`); lazy options sections; drafts/failed
  edits preserved with Retry/Discard. Spec: `docs/PHASE4.md`.
- Numbers: 842 unit tests (65 files), 29 Playwright e2e on installed
  Chrome; gz JS popup 33.7 KB / side panel 36.0 / dashboard 27.8 /
  options 16.1 / background 39.4 / total 121.9 KB (all within budget);
  dashboard painted ≈ 15–45 ms, popup ≈ 20–40 ms.
- Reviews: Codex (`docs/reviews/phase4-codex.md`) + Gemini
  (`phase4-gemini.md`), triaged in `phase4-triage.md` (28 + 13 rows), two
  fix passes (UI; core/worker/tooling). Rejected with evidence: per-card
  chunk splitting (popup budget), decoupling first paint from store init
  (measured fine), dashboard window-id claim, CommonMark lazy
  continuation, "missing test (l)".
- Deferred to Phase 5: search index per open NTP (measure), CLS
  measurement with real content, scrim contrast tool check, axe in e2e,
  grid-pattern lists, `REPO_URL`, same-named sibling bookmark folders
  merge (documented), queued widget edits lost on unmount while an error
  row is shown (note drafts survive; todos/links do not).
- Known gaps carried: manual QA Q1–Q12 not yet run; Edge untested; real
  bookmarks permission grant unverified end-to-end; DnD untested
  automatically; two-window NTP switching and delayed pomodoro alarms
  manual only (Q11/Q12).
- Next: Phase 5 per `docs/ARCHITECTURE.md` §11 — onboarding, a11y pass
  (grid lists, axe), i18n readiness, icons/store assets, COMPATIBILITY.md
  (fork matrix), README/CONTRIBUTING, release workflow, v1.0.0; Codex +
  Gemini final review.

## Review process (every phase)

1. Finish phase deliverables; tests + lint + build green.
2. Codex review: `codex exec --sandbox read-only -m <frontier> "<prompt>"`
   → `docs/reviews/phaseN-codex.md`.
3. Gemini review: `agy -p "<prompt>" --sandbox --model gemini-3.8-flash-high`
   → `docs/reviews/phaseN-gemini.md`.
4. Triage findings into `docs/reviews/phaseN-triage.md` (accept / reject
   with reason), apply accepted fixes, re-run tests.
5. Commit, tag `phase-N`, update this file, check usage limits before
   starting the next phase.

## Phase log

| Phase | Status | Tag | Notes |
|---|---|---|---|
| 0 | done | `phase-0` | design reviewed by Codex + Gemini; scaffold green |
| 1a | done | — | spike S1–S14 on Chrome + Brave (`docs/SPIKE.md`) |
| 1 | done | `phase-1` | core + engine; 2 review rounds; 476 tests |
| 2 | done | `phase-2` | popup/side panel/recovery; 2 reviews, 2 fix passes; 522 tests, 8 e2e |
| 3 | done | `phase-3` | suspension, duplicates, options, sync, bookmarks; 2 reviews, 2 fix passes; 684 tests, 16 e2e |
| 4 | done | `phase-4` | dashboard/newtab, HTML export, reminder, perf gate; 2 reviews, 2 fix passes; 842 tests, 29 e2e |
| 5 | pending | | |
