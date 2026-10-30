# Tabitat — progress & resume checkpoint

This file is the single place to look when resuming work after a pause.
Update it at the end of every phase (and at any forced pause).

## Current checkpoint

- Phase: 1 complete → tag `phase-1`.
- State: core domain (264 tests), platform adapters + fake browser with
  failure injection, typed RPC, background services (lanes, command
  router, repository with per-item salvage, init barrier with degraded
  mode, reconciler, tab tracker with last-known rescue, durable switch
  engine, session guard, reversible backup/import, suspender, pomodoro,
  badge, commands), dev popup. 476 unit tests, 3 Playwright e2e on
  installed Chrome incl. a real worker-kill mid-switch test. Reviewed
  twice by Codex + Gemini (`docs/reviews/phase1-*.md`, triage in
  `phase1-triage.md`); all must-fix items resolved.
- Known gaps carried into Phase 2: recovery page is a stub (Phase 2
  deliverable); suspected direct-tab duplicates after a worker restart
  are only logged; manual QA items Q1–Q10 not yet run; Edge untested.
- Next: Phase 2 — popup + side panel + recovery UI per `docs/UI-SPEC.md`,
  then Codex + Gemini review.

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
| 2 | pending | | |
| 3 | pending | | |
| 4 | pending | | |
| 5 | pending | | |
