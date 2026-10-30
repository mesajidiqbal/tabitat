# Tabitat — progress & resume checkpoint

This file is the single place to look when resuming work after a pause.
Update it at the end of every phase (and at any forced pause).

## Current checkpoint

- Phase: 2 implemented (commit `5dea23b`), **paused for review**.
- State: popup, side panel, recovery page per `docs/UI-SPEC.md`; shared
  signals store, incremental search index, keyboard map, i18n (en),
  theme, icons; 2 additive RPC commands (`recovery.dismiss`,
  `system.purgeCorrupt`). 484 unit tests, 8 Playwright e2e on installed
  Chrome. Popup JS 37 KB gz, first paint ≈ 20–30 ms.
- Reviews: Gemini review running → `docs/reviews/phase2-gemini.md`.
  Codex review **pending** (Codex usage limit reached at ~01:00 IST on
  2026-10-31; resume at 03:00 IST). Then triage both →
  `phase2-triage.md`, fix, verify, tag `phase-2`.
- Known gaps from the implementer: no component tests (no DOM lib);
  quick links not in search; dashboard/options pages don't apply theme
  yet (Phase 4); side panel shows other windows' Unsorted workspaces as
  cards (review question); no drag-and-drop.
- Next after `phase-2`: Phase 3 — suspension UI, duplicate detection UX,
  trash/undo polish, options page, settings sync, bookmarks import.

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
| 2 | implemented, review pending | — | UI; Codex paused until 03:00 IST |
| 3 | pending | | |
| 4 | pending | | |
| 5 | pending | | |
