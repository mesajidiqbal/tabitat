# Phase 1a — browser behaviour spike

Purpose: measure, in a real Chromium build, the assumptions §5 of
ARCHITECTURE.md rests on, before the WorkspaceEngine is written. Each
experiment is a small script run from the dev build (`npm run dev`) or a
Playwright test under `tests/spike/`. Record results below; if a result
contradicts the architecture, amend §5 and the relevant ADR first.

| # | Question | Method | Pass criterion | Result |
|---|---|---|---|---|
| S1 | Does creating 20 `suspended.html#u=…` placeholder tabs trigger any network load of the target URLs? | create 20 placeholders, inspect `chrome://net-export` / Playwright request log | zero requests to target hosts | pending |
| S2 | Time to create 20 placeholders + activate one + remove 20 old tabs | `performance.now()` around the plan execution | p95 < 500 ms | pending |
| S3 | Placeholder → real page on activation: does `location.replace(u)` keep the tab's position/group and give a clean history (Back does not return to placeholder)? | activate, press Back | no placeholder in history | pending |
| S4 | Browser restart keeps placeholders with hash intact, and `tabs.query` exposes their URL (incl. hash) | restart via Playwright persistent context relaunch | `w=`/`u=` recoverable | pending |
| S5 | `chrome.alarms` minimum period and `when` precision on Chrome 121+ | create alarms with 1 s, 30 s, 60 s | observe clamping | pending |
| S6 | SW killed mid-switch: kill via `chrome://serviceworker-internals` (or `chrome.runtime.reload`) between stages | op record on disk; relaunch | engine resumes from stage, no tab lost, no duplicate created | pending |
| S7 | `tabs.remove` with a mix of valid and already-closed ids | call once | rejects? (if yes, remove individually) | pending |
| S8 | `tabs.group` on tabs just created (before load) + `tabGroups.update` color/title | create → group | works without waiting for `complete` | pending |
| S9 | `commands` fire while SW asleep and popup closed | wait 60 s idle, press shortcut | handler runs | pending |
| S10 | Open side panel from popup click (`sidePanel.open({windowId})` within user gesture) and from a command | both paths | opens | pending |
| S11 | `tabs.discard` on a loaded tab: title/favicon retained? `lastAccessed` present? | discard, query | both true | pending |
| S12 | `chrome.search.query` from dashboard uses default engine | query | opens results | pending |
| S13 | Creating a tab with `chrome://settings` / `edge://` from the extension | create | allowed | pending |
| S14 | `storage.local` write/read latency for a 50-tab `ws:tabs` record, and `onChanged` delivery delay to an open popup | measure 100 iterations | p95 < 10 ms write, < 20 ms event | pending |

Browsers to run the spike on: Chrome stable, Brave, Edge (Arc/Vivaldi/
Opera in Phase 5 compatibility pass).
