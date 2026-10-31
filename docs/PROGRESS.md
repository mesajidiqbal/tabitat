# Tabitat — progress & resume checkpoint

This file is the single place to look when resuming work after a pause.
Update it at the end of every phase (and at any forced pause).

## Current checkpoint

- Phase: **5 implemented** (commit after `d014335`), version `1.0.0`,
  **paused for the final Codex review** (Codex usage limit hit at ~06:25
  IST on 2026-10-31; one-shot wake-up at 08:04 IST reruns it from
  `docs/reviews/phase5-codex-prompt.txt`). Gemini's final review is done
  and its accepted items are fixed (`docs/reviews/phase5-triage.md`).
- State: onboarding tour (once on install, `meta.onboardedAt`), APG grid
  pattern for the four row lists + axe in e2e (zero violations, light and
  dark), token contrast fixes, i18n check script in `npm run check`,
  manifest `__MSG_` keys, unused `sessions` permission removed, store
  assets generator + `store/README.md`, README / CONTRIBUTING /
  COMPATIBILITY / PRIVACY / SECURITY / CHANGELOG 1.0.0 / docs/RELEASE.md /
  docs/I18N.md, release workflow (tag = package version, zips renamed,
  CHANGELOG section as body). Spec: `docs/PHASE5.md`.
- Numbers: 867 unit tests (68 files), 51 Playwright e2e on installed
  Chrome (incl. a11y + onboarding), budgets green (popup 34.3 KB,
  onboarding 10.6 KB, total 124.8 KB gz JS).
- On resume (the cron prompt has the exact steps): Codex final review →
  triage → fix → verify → commit → tag `phase-5` → update this file →
  usage check → hand the release checklist to the customer.
- **Customer actions before v1.0.0** (`docs/RELEASE.md` §7–8, `docs/PHASE5.md`
  §8): choose repository name/org and set `REPO_URL` + placeholders
  (`<repo-url>`, `<maintainer email>`, `<chrome-web-store-url>`); run
  `docs/MANUAL-QA.md` Q1–Q15 on Chrome and Brave/Edge; push `main` and the
  `phase-*` tags; tag `v1.0.0` (release workflow builds the zips); create
  the Web Store listing from `store/README.md` (note: popup/side panel
  screenshots are 2× captures, the store accepts only 1280×800 or
  640×400; dashboard/options captures are 1280×800).
- Known gaps carried: manual QA not yet run; Edge/Vivaldi/Opera/Arc
  untested; real bookmarks permission grant unverified end-to-end; DnD
  untested automatically; queued widget edits lost on unmount while an
  error row is shown; input border contrast (1.6:1) left as a design
  call; `_execute_action` shown in options shortcuts but not in the tour.

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
| 5 | implemented, Codex review pending | — | onboarding, a11y, i18n, assets, docs, release; Gemini reviewed + fixed; 867 tests, 51 e2e |
