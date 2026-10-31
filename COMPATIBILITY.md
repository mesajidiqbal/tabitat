# Compatibility

Tabitat targets Chromium-based desktop browsers. The manifest sets
`"minimum_chrome_version": "121"`, so a browser must be built on Chromium 121 or later. Only Chrome
and Brave have been exercised, and only in part. Everything else below is "untested, expected to
work" because it is Chromium, not because anyone ran it. Where a fact is not established, the table
says **verify**.

## What was actually tested

- **Chrome 156.0.8078.79 (macOS):** the Phase 1a spike (`docs/SPIKE.md`, experiments S1 to S14),
  and the Playwright end-to-end suite, which runs on installed Chrome.
- **Brave 156.1.98.60 (macOS):** the same spike run. The e2e suite and the manual checklist
  (`docs/MANUAL-QA.md`) have not been run on Brave yet.
- **Edge, Vivaldi, Opera, Arc:** nothing.
- The manual checklist Q1 to Q15 is pending for every browser; results go in the table at the end
  of `docs/MANUAL-QA.md`.

## Fork matrix

| Browser | Minimum version | Side panel API | `chrome.search` web search | New tab override (New Tab flavor) | Tab groups | `tabs.discard` replaces the tab id | Status |
|---|---|---|---|---|---|---|---|
| Chrome | 121 (manifest) | Built in. `setOptions`/`getOptions` measured OK; `open()` needs a user gesture (S10) | Measured: opened the default engine in a new tab (S12) | Supported by `chrome_url_overrides`; Chrome may prompt users about new tab changes (ADR-004) | `tabs.group` and `tabGroups.update` measured OK on loading tabs (S8) | Yes, measured (S11); handled with `tabs.onReplaced` | Tested: spike and e2e on 156 |
| Brave | Chromium 121 or later; Brave release mapping: verify | `setOptions`/`getOptions` measured OK, `open()` needs a gesture, same as Chrome (S10) | verify (measured on Chrome only) | verify. Brave has its own new tab page; not tested with the New Tab flavor | Spike run on Brave; per-browser split not recorded, verify | Spike run on Brave; per-browser split not recorded, verify | Spike only (156.1.98.60); manual QA pending |
| Edge | Chromium 121 or later; Edge release mapping: verify | verify (Edge has its own sidebar; support of `chrome.sidePanel` not confirmed) | verify | verify. Edge may show its own prompts about extension-controlled new tab pages | verify | verify | Untested, expected to work (Chromium) |
| Vivaldi | Chromium 121 or later; Vivaldi release mapping: verify | verify | verify | verify | verify | verify | Untested, expected to work (Chromium) |
| Opera | Chromium 121 or later; Opera release mapping: verify | verify | verify | verify | verify | verify | Untested, expected to work (Chromium) |
| Arc | Chromium 121 or later; Arc release mapping: verify | verify | verify | verify. Arc has its own new tab behavior | verify | verify | Untested, expected to work (Chromium) |

## Known behaviors that apply to every browser

- **Internal pages.** Tabitat can create `chrome://` and `about:` tabs directly. It is designed to
  also create `edge://` on Edge and `brave://` on Brave, detected at runtime from
  `navigator.userAgentData.brands` (ARCHITECTURE section 5.3). Creating another browser's internal
  scheme gives an empty tab (S13), so those tabs are reported as skipped instead. `vivaldi://` and
  `opera://` URLs are accepted in stored data but are not created directly; they are skipped.
  Whether a browser actually reports its name in `userAgentData.brands` (Brave in particular), and
  whether Edge, Vivaldi, Opera and Arc behave as designed here, is unverified.
- **Imports across browsers.** A backup that holds `edge://` tabs, opened in Chrome, lists them as
  skipped instead of opening empty tabs (manual check Q10).
- **Alarms.** The 30-second floor for `chrome.alarms` is enforced by Chrome only on packaged
  installs; Tabitat never asks for less (S5). Not measured on a packaged install.
- **Service worker.** The worker is stopped after about 30 seconds idle in the tested Chrome and
  Brave (S6) and restarts on the next message; nothing durable lives only in memory: every record
  is written to storage before the worker may stop, and in-flight operations keep a journal so they
  resume (ARCHITECTURE 5.2).
- **Side panel.** Opening it needs a user gesture (toolbar button, popup button, or the
  `toggle-side-panel` command); it cannot be opened from the worker without one (S10).
- **Keyboard shortcuts.** Whether a key is accepted depends on the browser's own shortcut handling
  and on keys other extensions already use. Change them on the browser's extension shortcuts page.
- **Incognito.** Tabitat is `incognito: not_allowed`; incognito windows are never tracked.
- **Loading the extension for testing.** Branded Chrome 137 and later ignores `--load-extension`
  (SPIKE finding 2); the test harness loads it over CDP.

## How to report a compatibility issue

Open an issue at `https://github.com/mesajidiqbal/tabitat/issues` and include:

1. Browser name and exact version (the About page: `chrome://version`, `brave://version`,
   `edge://version`, ...), operating system and version.
2. Tabitat version and flavor (Options, About), and whether it was installed from the store, a
   release zip or source.
3. What you did, what you expected, what happened. For a workspace switch, say how many tabs were
   involved and whether any were pinned, grouped or `chrome://` pages.
4. The row in the table above you expect to be wrong, and for a crash or a stuck switch, the
   console output of the service worker (`chrome://extensions`, Details, "service worker").
5. Please do not attach a backup or screenshots that show private URLs. A backup is plain JSON
   with full URLs and titles.

Reports that include the browser version and a minimal reproduction are turned into rows in this
matrix, with the evidence.
