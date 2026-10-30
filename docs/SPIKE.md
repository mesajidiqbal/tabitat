# Phase 1a — browser behaviour spike

Purpose: measure, in a real Chromium build, the assumptions §5 of
ARCHITECTURE.md rests on, before the WorkspaceEngine is written. Each
experiment is a small script run from the dev build (`npm run dev`) or a
Playwright test under `tests/spike/`. Record results below; if a result
contradicts the architecture, amend §5 and the relevant ADR first.

| # | Question | Method | Pass criterion | Result |
|---|---|---|---|---|
| S1 | Does creating 20 `suspended.html#u=…` placeholder tabs trigger any network load of the target URLs? | create 20 placeholders, inspect `chrome://net-export` / Playwright request log | zero requests to target hosts | PASS (Chrome 156 and Brave 156, driver-free CDP): 0 server hits for 20 inactive placeholders; only the activated one fetched its target. Under Playwright page control all 20 load (it forces `visible`): harness artifact, see Findings |
| S2 | Time to create 20 placeholders + activate one + remove 20 old tabs | `performance.now()` around the plan execution | p95 < 500 ms | PASS: 20 create + activate + remove 20 = p50 ~120 ms, p95 ~130 ms (8 rounds; create ~60, remove ~55, activate ~5). Brave p50 112 ms |
| S3 | Placeholder → real page on activation: does `location.replace(u)` keep the tab's position/group and give a clean history (Back does not return to placeholder)? | activate, press Back | no placeholder in history | PASS: tab index unchanged (8 -> 8); `tabs.goBack` rejects "Cannot find a next page in history." so no placeholder in history. Group membership not measured |
| S4 | Browser restart keeps placeholders with hash intact, and `tabs.query` exposes their URL (incl. hash) | restart via Playwright persistent context relaunch | `w=`/`u=` recoverable | PASS (driver-free, Chrome + Brave): 3/3 placeholders restored with `#u=…&w=ws1` hash intact via `tabs.query`; 0 target fetches on restore. Chrome extension was loaded via CDP after restore began (ordering differs from an installed extension) |
| S5 | `chrome.alarms` minimum period and `when` precision on Chrome 121+ | create alarms with 1 s, 30 s, 60 s | observe clamping | Unpacked: no clamping. 1/60 min accepted (fired 60x in 60 s); 0.5 min first fire 30.1 s; 1 min 60.2 s; `when`+1 s and `delayInMinutes` 1/60 fired at ~1.0 s. Packaged-store clamp (30 s) NOT measured: needs a packed install |
| S6 | SW killed mid-switch: kill via `chrome://serviceworker-internals` (or `chrome.runtime.reload`) between stages | op record on disk; relaunch | engine resumes from stage, no tab lost, no duplicate created | Partial. SW force-stopped (CDP stopWorker) and idle-killed: worker gone after 30.0 s idle (devtools detached); `runtime.sendMessage` from popup with no handler errors "Could not establish connection. Receiving end does not exist." yet the worker is revived. `op:switch:1` record persisted and all 3 tab ids still valid after kill. `runtime.reload` NOT measurable: extension is not re-enabled after reload under automation (Chrome CDP-loaded and Brave flag-loaded) |
| S7 | `tabs.remove` with a mix of valid and already-closed ids | call once | rejects? (if yes, remove individually) | `tabs.remove([valid, closed])` REJECTS: "No tab with id: <n>."; the valid tab was already removed. Remove individually or tolerate the rejection |
| S8 | `tabs.group` on tabs just created (before load) + `tabGroups.update` color/title | create → group | works without waiting for `complete` | PASS: group + `tabGroups.update` on tabs with status "loading": no error; create 23-24 ms, group+update 12 ms |
| S9 | `commands` fire while SW asleep and popup closed | wait 60 s idle, press shortcut | handler runs | Partial: `commands.getAll()` returns 6 entries (_execute_action + 5); shortcuts assigned for open-search (Cmd+Shift+K), next-workspace (Cmd+Shift+.), prev-workspace (Cmd+Shift+,); suspend-other-tabs and toggle-side-panel have none (no suggested_key). Key activation with SW asleep NOT measured: manual check |
| S10 | Open side panel from popup click (`sidePanel.open({windowId})` within user gesture) and from a command | both paths | opens | Partial: `sidePanel.setOptions/getOptions` OK. `sidePanel.open({windowId})` from the SW with no gesture rejects: "`sidePanel.open()` may only be called in response to a user gesture." From an extension page it resolved without a real gesture (CDP-driven). Real popup-click and command paths: manual check. Brave identical |
| S11 | `tabs.discard` on a loaded tab: title/favicon retained? `lastAccessed` present? | discard, query | both true | PASS with caveat: after `tabs.discard` discarded=true, title kept ("Target /loaded"), `lastAccessed` present. favIconUrl null (test page has no favicon, not conclusive). **The tab id CHANGED** (discard returned a new id; old id gone) |
| S12 | `chrome.search.query` from dashboard uses default engine | query | opens results | PASS: `chrome.search.query({text, disposition:"NEW_TAB"})` opened a tab on www.google.com (default engine; second run hit google.com/sorry rate-limit page) |
| S13 | Creating a tab with `chrome://settings` / `edge://` from the extension | create | allowed | `chrome://settings` and `chrome://version` created and loaded (titles Settings / About Version). `edge://` and `brave://` create "succeeds" but the tab ends with empty url/title in Chrome (invalid scheme) |
| S14 | `storage.local` write/read latency for a 50-tab `ws:tabs` record, and `onChanged` delivery delay to an open popup | measure 100 iterations | p95 < 10 ms write, < 20 ms event | PASS: 50-tab record (13.5 KB): set p50 0.3 ms / p95 0.4-0.5 ms; get p50 0.2 ms / p95 0.3 ms; onChanged to open popup 30/30 events, p50 1 ms / p95 1 ms (Date.now, 1 ms resolution) |

Browsers to run the spike on: Chrome stable, Brave, Edge (Arc/Vivaldi/
Opera in Phase 5 compatibility pass).

## Findings (run 2026-10-30, Chrome 156.0.8078.79 and Brave 156.1.98.60, macOS)

Run with `npm run build && npm run spike`. Edge not run.

1. **Build bug (blocks loading):** the built manifest has `_locales/` but no
   `default_locale`, so Chrome refuses the extension ("Localisation used, but
   default_locale wasn't specified"). The spike loads a patched temp copy.
   Fix in `wxt.config.ts`: add `default_locale: "en"` to the manifest. The
   existing `tests/e2e/smoke.spec.ts` cannot pass until this is fixed (and
   it also needs a Chromium that honours `--load-extension`).
2. **Branded Chrome >= 137 ignores `--load-extension`.** The spike loads it
   with CDP `Extensions.loadUnpacked` (and must not pass
   `--disable-extensions-except`). Brave still honours the flag. Neither
   kind of load survives `chrome.runtime.reload()` under automation.
3. **Playwright defeats the placeholder.** Playwright force-enables
   focus/visibility emulation on pages it controls, so inactive tabs report
   `visible` and all 20 placeholders load immediately (S1 Playwright run:
   20/20 fetched). Driver-free measurements (`tests/spike/raw*.ts`, plain
   CDP, no page emulation) show the intended behaviour: hidden until
   activated, 0 fetches. Any future e2e that asserts "no load" must use the
   raw driver, not Playwright pages.
4. **Placeholders load on visibility, which depends on the OS window.** An
   occluded macOS window keeps a just-activated tab `hidden` (1 of ~6 early
   runs did not load within 3 s). With `--disable-backgrounding-occluded-windows`
   6/6 loaded. Click/keypress fallback covers it; the engine must not assume
   activation implies load.
5. **`tabs.discard` changes the tab id** (old id invalid). The Suspender and
   TabTracker must handle `tabs.onReplaced` / use the returned tab and never
   key state on the pre-discard id. This touches invariant I3 and §5.7.
6. **`tabs.remove` with a stale id rejects** (and has already removed valid
   ids listed before it). Remove ids individually or treat rejection as
   success then re-query (§5.3 stage 4 says stale ids "are ignored": that
   is not true of a batched call).
7. **Service worker idle kill is 30 s**; a message with no listener still
   revives it. Op records and tab ids survived a force-stop.
8. `alarms`: unpacked builds are not clamped (1 s period fired every
   second). §5.2's "alarms >= 30 s" rule is only enforceable on packaged
   installs; keep the 30 s floor in code.
9. `edge://` / `brave://` create calls do not reject in Chrome but produce an
   empty tab; §5.3 should only direct-create the schemes of the running
   browser (`chrome://`, `about:`) and report the rest.
10. Not measured: S9 key activation, S10 real gesture/command paths, S5
    store-packaged clamping, S6 `runtime.reload`, Edge, favicon retention on
    discard (needs a page that serves one).

