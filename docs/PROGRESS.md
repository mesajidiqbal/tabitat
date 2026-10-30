# Tabitat — progress & resume checkpoint

This file is the single place to look when resuming work after a pause.
Update it at the end of every phase (and at any forced pause).

## Current checkpoint

- Phase: **2 done**, tagged `phase-2` (2026-10-31, ~04:15 IST).
- State: popup, side panel, recovery page per `docs/UI-SPEC.md`; shared
  signals store, incremental search index, keyboard map, i18n (en),
  theme, icons; 2 additive RPC commands (`recovery.dismiss`,
  `system.purgeCorrupt`). 522 unit tests, 8 Playwright e2e on installed
  Chrome (popup painted mark ≈ 33 ms, asserted < 300 ms). Build 264 KB
  per flavor.
- Reviews: Gemini (`docs/reviews/phase2-gemini.md`) and Codex
  (`phase2-codex.md`), triaged in `phase2-triage.md`; two fix passes
  applied (Gemini-accepted items, then Codex-accepted items). Rejected
  with evidence: fuzzysort threshold (v4 scores 0–1), Unsorted not in
  index (it is), side panel following focus (per-window by design),
  interrupted restore "loads every tab" (already placeholder-first).
- Deferred from the Phase 2 reviews (tracked here, not lost):
  - Phase 3: recovery banner "newer generation than tracked state"
    signal from the worker; drag a tab onto saved links; adopt
    `happy-dom` for component tests (TabRow menu, `p` key, focus
    recovery are untested today); `TabRow` is 153 lines (> 120 guideline).
  - Phase 4: generation export (sessions page button is "Export backup"
    for now); search per-workspace change tracking; bundle-size CI gate;
    re-measure paint with decoupled hydration.
  - Phase 5: grid pattern (`row`/`gridcell`) for workspace/tab/link/closed
    lists (interactive controls inside `role="option"` today); axe check
    in e2e.
- Known gaps carried from Phase 1/2: quick links not in search;
  dashboard/options pages don't apply theme yet (Phase 4); manual QA
  Q1–Q10 not yet run; Edge untested; suspected direct-tab duplicates only
  logged; worker error detail for `limit`/`invalid` is a tooltip only.
- Next: Phase 3 per `docs/ARCHITECTURE.md` §11 — suspension UI,
  duplicate detection UX, trash/undo polish, options page, settings sync,
  bookmarks import; Codex + Gemini review at the end.

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
| 3 | pending | | |
| 4 | pending | | |
| 5 | pending | | |
