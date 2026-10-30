# Tabitat — progress & resume checkpoint

This file is the single place to look when resuming work after a pause.
Update it at the end of every phase (and at any forced pause).

## Current checkpoint

- Phase: 0 complete → tag `phase-0`.
- State: ARCHITECTURE.md v1 finalized after Codex + Gemini review
  (triage in `docs/reviews/phase0-triage.md`, ADR-001…004). Repo
  scaffolded: WXT 0.21, Preact 10 + signals, valibot, fuzzysort, idb,
  Biome, Vitest 5, Playwright, CI + release workflows, two build flavors
  (default / newtab). `npm run check` and both builds are green.
- Next: Phase 1a browser spike (`docs/SPIKE.md`), then Phase 1 core
  (schemas, migrations, switch planner, CommandRouter, TabTracker,
  WorkspaceEngine, Reconciler, SessionGuard, export/import, failure
  injection tests), then Codex + Gemini review of Phase 1.

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
| 1a | pending | | browser spike |
| 1 | pending | | |
| 2 | pending | | |
| 3 | pending | | |
| 4 | pending | | |
| 5 | pending | | |
