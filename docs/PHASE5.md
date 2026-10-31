# Phase 5 spec — onboarding, accessibility, i18n readiness, assets, docs, release

Final phase per `docs/ARCHITECTURE.md` §11. Additive to every existing contract.
Rules unchanged: UI never writes `chrome.storage`; saved state changes go
through `send()`; strings via `t()`; no network; `src/core` pure.

The engineering work below is done by the agents; the **release actions**
(creating the public repository, pushing, tagging `v1.0.0`, Web Store
submission) are the customer's decisions and are listed in §8 as a checklist.

## 1. Onboarding

- `src/entrypoints/onboarding/` (Preact, theme, i18n `onb*` keys): a single
  page with four short cards and a "Done" button:
  1. Workspaces: what a workspace is; switching saves the outgoing tabs and
     opens the incoming ones as lightweight placeholders; the **known
     limitation** (in-page state such as scroll position and unsaved forms is
     not kept across a switch; pinned tabs stay with the window) in plain words
     (ARCHITECTURE §2.3).
  2. Where things live: toolbar popup, side panel (how to open it), dashboard
     (and the new-tab flavor: "install only one flavor"; ADR-004).
  3. Shortcuts: the five commands with their current keys from
     `chrome.commands.getAll()` and a "Change in Chrome" link.
  4. Privacy: local-only, no network, optional settings sync carries settings
     only, backups are plain files you download.
- Opened once: the existing `runtime.onInstalled` listener in
  `src/entrypoints/background.ts` opens `onboarding.html` when
  `details.reason === "install"` and `meta.onboardedAt` is unset; the page's
  Done button calls a new command `system.onboarded {}` → sets
  `meta.onboardedAt` (additive `Meta` field). Also reachable from options →
  About ("Show the welcome tour").
- Must paint from storage like the other pages; ≤ 15 KB gz JS (budget added
  to `scripts/check-budgets.mjs`).

## 2. Accessibility pass

- **Grid pattern** for the four row lists (workspaces, tabs, saved links,
  recently closed) in popup and side panel: container `role="grid"` with
  `aria-rowcount`, each row `role="row"`, the primary cell `role="gridcell"`
  holding the row content (activation on Enter/Space), one more `gridcell`
  holding the action buttons (visible on hover/focus-within as today). Roving
  focus stays per row (`useRoving` unchanged in behavior); `ArrowRight` /
  `ArrowLeft` move between the row's cells (primary ↔ actions), `Home`/`End`
  rows. Search results keep `role="listbox"`/`option` (combobox pattern), but
  the empty state stays `role="status"`. `focusList` updated for the new roles.
  Tab group headers become `role="row"` with one `gridcell` (button inside).
- **axe in e2e**: `@axe-core/playwright` (dev dep); `tests/e2e/a11y.spec.ts`
  runs axe on popup, side panel, dashboard, options (every section), recovery,
  onboarding and the suspended page, each seeded with data, asserting zero
  `serious`/`critical` violations; `moderate`/`minor` are printed. Known
  exclusions must be listed with a reason in the test file (expect none).
- Focus audit: every interactive element has a visible `:focus-visible` ring
  (theme token), menus restore focus, dialogs trap focus; `prefers-reduced-
  motion` already honored; color contrast ≥ 4.5:1 for text, ≥ 3:1 for UI
  glyphs (check `--fg-subtle` on `--bg-elev`, chips, badges, scrim).
- Screen-reader labels: every icon-only button has `aria-label`; live regions:
  toast (`role=status`), progress row (`role=status`), error banner
  (`role=alert`), pomodoro transitions (`role=status`).

## 3. i18n readiness

- `scripts/check-i18n.mjs` (+ `npm run i18n`, in `npm run check` after lint):
  fails on (a) keys in `messages.json` not referenced anywhere (`t("key")`,
  `plural(...)`, `getMessage("key")`, `__MSG_key__`, `EXPORT_LABEL_KEYS`,
  known dynamic prefixes like `err_`, `stage_`, `reason_`, `optBmWarn_`,
  `dash` greetings; dynamic families are declared in the script), (b)
  `t("key")` references with no entry, (c) placeholder mismatches
  (`$1`/`$NAME$` used but not declared). Dev-only strings in tests are
  ignored.
- `manifest`: `name`, `description`, command descriptions and the action
  title use `__MSG_*__` keys (`appName` / `appNameNewTab`, `appDescription`,
  `cmd*`), so the store listing is translatable.
- `docs/I18N.md` (short): how to add a locale (copy `en`, keep placeholders,
  run `npm run i18n`), what is deliberately not translated (brand name).

## 4. Store assets

- `scripts/store-assets.ts` (Playwright, uses the e2e harness, `npm run
  assets`): seeds a demo dataset (three named workspaces with realistic
  titles/URLs from a local fixture, quick links, todos, a note) and captures:
  popup (360×540 @2x), side panel (400×800 @2x), dashboard (1280×800),
  options (1280×800), all in light and dark → `store/screenshots/*.png`.
  Also renders `store/promo-440x280.png` and `store/promo-1400x560.png` from
  an SVG template (icon + wordmark + one line) via the same headless Chrome.
  `store/README.md` lists the Web Store listing fields (name, summary ≤ 132
  chars, description, category, language, privacy practices answers, single
  purpose statement) with the text filled in and the policy questions
  answered from ARCHITECTURE §10.
- `public/icon/` stays (generated by `scripts/gen-icons.mjs`); add a
  monochrome `icon/toolbar-*.png` variant only if the current icon fails
  contrast on dark toolbars (check, don't assume).

## 5. Documentation

- `README.md`: what it is (one paragraph, no marketing), feature list by
  surface, install (from the store once published; from a release zip; from
  source), both flavors, shortcuts, privacy summary, a screenshot, links to
  docs, license.
- `CONTRIBUTING.md`: prerequisites, scripts, architecture map (one screen),
  how to run e2e (installed Chrome), the review loop (Codex + Gemini triage
  docs under `docs/reviews/`), contract-change rules (additive, ADR for
  behavior changes), adding a locale, commit style, DCO/no CLA.
- `COMPATIBILITY.md`: fork matrix (Chrome, Brave, Edge, Vivaldi, Opera, Arc)
  with columns: minimum version, side panel, `chrome.search`, new-tab
  override behavior, tab groups, `tabs.discard`, tested? (Chrome 156 and Brave
  tested in Phase 1a; others "untested, expected to work" or known
  differences; be honest, no guesses stated as facts).
- `PRIVACY.md` (the store needs a privacy policy URL): what is stored, where,
  what leaves the device (nothing, except optional `storage.sync` settings
  and user-initiated web searches/downloads), permissions and why each is
  needed, data deletion (uninstall / "Reset" / "Empty trash"), contact
  placeholder.
- `SECURITY.md`: how to report, supported versions.
- `CHANGELOG.md`: `1.0.0` entry from the phase logs (features by surface,
  known limitations).
- `docs/MANUAL-QA.md`: the release checklist run (Q1–Q12) with a results
  table to fill in; add Q13 onboarding, Q14 a11y spot check with a screen
  reader, Q15 Edge/Brave smoke.

## 6. Release engineering

- `package.json` version → `1.0.0` (manifest version follows), `homepage_url`
  in the manifest from a single `REPO_URL` (placeholder until the repository
  exists; the About page and README use the same constant/text).
- `.github/workflows/release.yml`: on tag `v*`: `npm ci`, `npm run check`,
  both builds, `npm run budgets`, zips named `tabitat-<version>.zip` and
  `tabitat-newtab-<version>.zip`, GitHub release with the CHANGELOG section
  for that version as the body. No store upload automation (documented as a
  manual step with the `chrome-webstore-upload-cli` command in
  `store/README.md`).
- `ci.yml`: add `npm run i18n` (via `check`).

## 7. Out of scope

Store submission itself; per-browser store listings beyond Chrome; translations
other than `en`; telemetry (never).

## 8. Release checklist (customer actions; prepared, not executed)

1. Decide the repository name/organization; set `REPO_URL`, `homepage_url`,
   README links, PRIVACY contact; push `main` and the `phase-*` tags.
2. Run `docs/MANUAL-QA.md` Q1–Q15 on Chrome stable and at least Brave or Edge;
   record results.
3. Tag `v1.0.0` (release workflow publishes the zips).
4. Web Store: create the listing from `store/README.md`, upload
   `tabitat-1.0.0.zip` (and the New Tab listing separately), answer the
   privacy questionnaire, submit for review.

## 9. Acceptance

- `npm run check` (now incl. `i18n`), both builds, `npm run budgets`, `npx
  playwright test --project=e2e` (incl. `a11y.spec.ts` with zero
  serious/critical violations), `npm run assets` produces the files.
- Final Codex + Gemini review; triage in `docs/reviews/phase5-triage.md`; tag
  `phase-5`.
