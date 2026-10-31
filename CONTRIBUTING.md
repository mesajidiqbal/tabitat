# Contributing to Tabitat

Thanks for helping. Tabitat is a small TypeScript codebase with strict rules about data safety and
privacy; this page tells you how to build it, where things live, and what a change must respect.

## Prerequisites

- Node 24 and npm. `.node-version` pins it; with fnm, `fnm use` in the repository root picks it up.
- Google Chrome (stable) installed, only for the end-to-end tests. The tests drive your installed
  Chrome (branded Chrome 137+ ignores `--load-extension`, so the harness loads the extension over
  CDP; see `tests/support/extension.ts`). They never use Playwright's bundled Chromium.
- Optional: Brave (macOS path in `tests/support/extension.ts`) for the spike tests.

## Setup

```sh
npm ci                  # also runs `wxt prepare` (postinstall)
npm run check           # lint + typecheck + unit tests (+ i18n check)
npm run dev             # Chrome with the extension and HMR
```

## Scripts

| Script | What it does |
|---|---|
| `npm run check` | `lint`, `typecheck`, `test`, and the i18n check. Run before every push; CI runs it |
| `npm run lint` | Biome plus `scripts/check-core-purity.mjs` |
| `npm run typecheck`, `npm test` | `tsc --noEmit`; Vitest (unit and DOM tests, fake browser) |
| `npm run build`, `npm run build:newtab` | Production builds into `.output/` and `.output-newtab/` |
| `npm run budgets` | gzip size gate per surface and in total, for both builds (`scripts/check-budgets.mjs`); build both flavors first |
| `npm run e2e` | Playwright against installed Chrome and the built extension in `.output/chrome-mv3`; run `npm run build` first. Includes the axe accessibility spec |
| `npm run i18n` | `scripts/check-i18n.mjs`: fails on unused keys in `messages.json`, `t("key")` references with no entry, and placeholder mismatches ([docs/PHASE5.md](docs/PHASE5.md) section 3) |
| `npm run assets` | `scripts/store-assets.ts`: regenerates the store screenshots and promo images under `store/` from a demo dataset ([docs/PHASE5.md](docs/PHASE5.md) section 4) |
| `npm run zip`, `npm run zip:newtab` | Package the builds (`wxt zip`) |
| `npm run format` | Biome formatter, writes files |

## Repository map

```
src/
  core/          pure domain logic: model and schemas, switch planner, search, suspend rules,
                 pomodoro machine, reconcile matcher, markdown renderer, HTML export, sync rules
  platform/      thin adapters over chrome.* (storage, tabs, windows, tabGroups, alarms, ...)
  background/    service worker services: command router, workspace engine, tab tracker,
                 session guard, reconciler, suspender, pomodoro, backup, settings sync
  messaging/     typed RPC: Commands, envelopes, `send()` and the worker-side router, valibot schemas
  ui/            shared components, hooks, signals stores, widgets, theme.css
  entrypoints/   background, popup, sidepanel, dashboard, options, recovery, suspended
                 (+ onboarding in 1.0)
  i18n/          t() and plural helpers
tests/
  e2e/           Playwright on installed Chrome      support/   launch harness
  spike/         browser measurements (docs/SPIKE.md)
scripts/         build-time checks and generators (budgets, core purity, icons, i18n, assets)
public/          icons and _locales/en/messages.json
docs/            ARCHITECTURE, ADRs, per-phase specs, SPIKE, MANUAL-QA, RELEASE, reviews/
```

The design is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md); read sections 1, 5 and 6 first.

## Rules

1. **`src/core` is pure.** It must not import `wxt/browser` or reference `chrome.` / `browser.`.
   Browser access goes through `src/platform`. `scripts/check-core-purity.mjs` (part of
   `npm run lint`) enforces it.
2. **The UI never writes `chrome.storage`.** Surfaces read through `useStorageKey` (storage plus
   `onChanged`) and change saved state only through `send()` RPC commands handled by the service
   worker ([ADR-003](docs/adr/003-writes-through-service-worker.md)). The one documented exception
   is the wallpaper image blob in IndexedDB (docs/PHASE4.md). Surfaces may activate, focus or
   close a single tab directly.
3. **Contracts are additive.** New fields on stored records and new commands are optional or new;
   existing shapes and meanings do not change. A behavior change gets an ADR: add a new numbered
   file under `docs/adr/` rather than rewriting an old one.
4. **Never lose a tab.** Destructive browser operations are journaled in an op record, resumable,
   and covered by failure-injection tests. Do not weaken an invariant in ARCHITECTURE section 5.3
   without an ADR.
5. **No network.** Production CSP has `connect-src 'none'`; do not add host permissions, content
   scripts, remote code, fonts or analytics.
6. **Strings go through `t()`.** Add keys to `public/_locales/en/messages.json`; `npm run i18n`
   must pass.
7. **Stay inside the budgets.** `npm run budgets` fails when a surface grows past its gzip budget.
8. **Tests with the change.** Unit tests next to the code (`*.test.ts`, `*.dom.test.tsx` for
   components); an e2e spec when behavior crosses real browser APIs.

## Review loop

Each development phase ends with two independent reviews, run by the maintainer, then a triage:

1. Codex (read-only sandbox) and Gemini review the phase's diff against its spec. Raw output is
   saved as `docs/reviews/phaseN-codex.md` and `docs/reviews/phaseN-gemini.md`.
2. Every finding is re-checked against the source before a decision. Findings are recorded in
   `docs/reviews/phaseN-triage.md`, one table row each:

   | # | Finding | Sev | Decision | Evidence / fix |
   |---|---|---|---|---|
   | C-B2 | One-sentence statement of the problem | high | accepted | What you verified in the code, and the fix |

   `#` is `C-` plus an id for Codex findings and `G` plus a number for Gemini findings. Decision is
   one of: accepted, accepted with a different fix, deferred (tracked, with the phase it lands
   in), rejected (with the evidence). Older triage files use symbols for these four.
3. Accepted fixes land in a fix-pass commit, tests are re-run, and the phase is tagged
   `phase-N`. `docs/PROGRESS.md` records the checkpoint.

External contributors do not need to run this loop. A pull request that explains what you
verified, and how, is the equivalent.

## Adding a locale

Copy `public/_locales/en/messages.json` to `public/_locales/<code>/messages.json`, translate the
`message` values, keep every placeholder, and run `npm run i18n`. Full steps, and what is
deliberately not translated, are in [docs/I18N.md](docs/I18N.md).

## Commits and pull requests

- [Conventional Commits](https://www.conventionalcommits.org/) with an optional scope, as in
  `git log`: `feat(ui): ...`, `fix(background): ...`, `docs: ...`, `chore: ...`. Subject in the
  imperative, lowercase after the prefix. Use the body for the why.
- There is no CLA. A `Signed-off-by` (DCO) line is welcome but optional.
- Open an issue before a large change so the approach can be agreed against the architecture.
- Keep a pull request to one concern. It should pass `npm run check`, include tests, and say which
  of `npm run build`, `npm run budgets` and `npm run e2e` you ran.
- Do not paste personal tab data, backups or screenshots containing your URLs in an issue.
  For compatibility problems use the template in [COMPATIBILITY.md](COMPATIBILITY.md); for
  security problems follow [SECURITY.md](SECURITY.md), not a public issue.
