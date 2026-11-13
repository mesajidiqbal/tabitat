# Tabitat — progress & resume checkpoint

This file is the single place to look when resuming work after a pause.
Update it at the end of every phase (and at any forced pause).

## Current checkpoint

- Phase: **5 done** (tag `phase-5`), version `1.0.0`. **Engineering is
  complete; the next steps are the customer's release actions** below.
- Final reviews: Gemini (10 findings) and Codex (33 items) both triaged in
  `docs/reviews/phase5-triage.md`; every accepted item is fixed. Codex's
  blockers (grid focus tracking, inline confirm semantics, input border
  contrast, privacy/store wording, release-workflow guards) are all
  addressed; placeholders are enforced by a release-workflow step.
- State: onboarding tour (once on install, `meta.onboardedAt`), APG grid
  pattern for the four row lists with two-dimensional card navigation on
  the dashboard/side panel, axe in e2e incl. menu/confirm states (zero
  violations, light and dark), `--border-input` ≥ 3:1, queued widget edits
  that failed survive remounts, localized worker notifications, i18n
  check script in `npm run check`, manifest `__MSG_` keys, store assets +
  `store/README.md`, docs set, release workflow (tag = package version,
  placeholder check, packaged-manifest check, zips, CHANGELOG body).
  Spec: `docs/PHASE5.md`.
- Numbers: 887 unit tests (68 files), 56 Playwright e2e on installed
  Chrome, budgets green (popup 34.8 KB, onboarding 10.6 KB, total 125.6 KB
  gz JS).
- **Customer actions before v1.0.0** (`docs/RELEASE.md` §1–7, `docs/PHASE5.md`
  §8): repository is `https://github.com/mesajidiqbal/tabitat`
  (chosen 2026-10-31; placeholders, `REPO_URL`, contact
  `mesajidiqbal@gmail.com` filled; the store link is added after
  approval); create it on GitHub (not done); run `docs/MANUAL-QA.md`
  Q1–Q17 on Chrome plus Brave or Edge and record the local e2e run; push
  `main` and the `phase-*` tags; tag `v1.0.0` (release workflow builds the
  zips); create the Web Store listing from `store/README.md` (data usage:
  Web history, handled locally; popup/side panel screenshots are 2×
  captures, the store accepts only 1280×800 or 640×400).
- Git identity (2026-11-13): commits under `~/Developer/personal` use
  `Sajid Iqbal <mesajidiqbal@gmail.com>` via `includeIf` in `~/.gitconfig`;
  github.com remotes in that folder are routed to the `github-personal`
  SSH alias (`~/.ssh/id_ed25519_personal`, add its public key to the
  mesajidiqbal account). All local history was rewritten to that identity
  before the first push. Remote to add once the repository exists:
  `git remote add origin git@github.com:mesajidiqbal/tabitat.git`.
- Known gaps carried (post-1.0 candidates): manual QA not yet run;
  Edge/Vivaldi/Opera/Arc untested; e2e not run in CI (installed Chrome);
  pointer clicks on todo / quick-link tile buttons do not update the
  roving tab stop (keyboard paths do); actions-cell arrow keys are a
  simplification of the APG widget mode; `_execute_action` shown in
  options shortcuts but not in the tour.

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
| 5 | done | `phase-5` | onboarding, a11y, i18n, assets, docs, release; Gemini + Codex reviewed, 1 fix pass each; 887 tests, 56 e2e |
