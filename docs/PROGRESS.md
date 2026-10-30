# Tabitat — progress & resume checkpoint

This file is the single place to look when resuming work after a pause.
Update it at the end of every phase (and at any forced pause).

## Current checkpoint

- Phase: 0 (architecture / design / tech stack)
- State: ARCHITECTURE.md drafted; sent for review to Codex (GPT-6) and
  Gemini (3.8 Flash High via Antigravity CLI). Reviews land in
  `docs/reviews/phase0-*.md`.
- Next: fold review feedback into ARCHITECTURE.md + ADRs, then scaffold
  the repo (WXT + Preact + Biome + Vitest + CI) and tag `phase-0`.

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
| 0 | in progress | — | design doc under review |
| 1 | pending | | |
| 2 | pending | | |
| 3 | pending | | |
| 4 | pending | | |
| 5 | pending | | |
