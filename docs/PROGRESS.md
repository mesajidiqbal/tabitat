# Tabitat — progress & resume checkpoint

This file is the single place to look when resuming work after a pause.
Update it at the end of every phase (and at any forced pause).

## Current checkpoint

- Phase: **3 done**, tagged `phase-3` (2026-10-31, ~05:05 IST).
- State: suspension UI (`tabs.suspend`, `z`, whitelist toggles, placeholder
  page refresh), duplicate UX (chip, filter, close + undo, all windows),
  trash/undo polish, options page (9 sections, hash nav), opt-in settings
  sync via `storage.sync` (settings only, theme/image wallpaper local,
  monotonic `updatedAt` LWW, size/quota guard, `sync:status`), bookmarks
  import (optional permission, folder picker, planner preview, per-folder
  rule), `recovery:hint` banner, drag-to-park, quick links in search,
  idempotent saved links, happy-dom component tests, i18n fallback stripped
  from production builds. Spec: `docs/PHASE3.md`.
- Numbers: 684 unit tests (48 files), 16 Playwright e2e on installed
  Chrome, popup JS 39.3 KB gz (budget 40), build 325 KB per flavor.
- Reviews: Codex (`docs/reviews/phase3-codex.md`) + Gemini
  (`phase3-gemini.md`), triaged in `phase3-triage.md` (27 + 10 rows); two
  fix passes (worker, UI) applied. Rejected with evidence: duplicate-group
  recompute cost, "missing tests" (not in Gemini's bundle).
- Deferred from Phase 3 reviews:
  - Phase 4: lazy-load options sections; per-workspace search change
    tracking; bundle-size CI gate (popup JS ≤ 40 KB gz, measured in e2e or a
    script); generation export; backup reminder; `restoreLimit` field
    native-step mismatch (step 10) like the fixed minutes field.
  - Phase 5: About → repository URL (`REPO_URL` constant, no repo yet);
    grid-pattern lists; axe in e2e; same-named sibling bookmark folders
    merge (documented behavior, revisit if users complain).
- Known gaps carried: dashboard/options theme parity is fine now but the
  dashboard page itself is still a placeholder (Phase 4); manual QA
  Q1–Q10 not yet run; Edge untested; real bookmarks permission grant flow
  unverified end-to-end (e2e stubs `chrome.bookmarks`); DnD has no
  automated test; `NumberField` commits with the rev at commit time
  (300 ms window) while the whitelist editor uses a draft rev.
- Next: Phase 4 per `docs/ARCHITECTURE.md` §11 — dashboard + newtab flavor
  widgets (clock, search, quick links, workspaces, todos, notes, pomodoro,
  theme/wallpaper, widget toggles), HTML export, backup reminder, perf CI
  gate; Codex + Gemini review at the end.

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
| 4 | pending | | |
| 5 | pending | | |
