# Phase 0 review triage

Reviewers: Codex (GPT-6, `docs/reviews/phase0-codex.md`), Gemini 3.8 Flash
High via Antigravity (`docs/reviews/phase0-gemini.md`). Both were asked the
same questions about `docs/ARCHITECTURE.md` v0.

Legend: ✅ accepted · ➖ partially accepted · ❌ rejected (with reason)

| # | Finding | Codex | Gemini | Decision |
|---|---|---|---|---|
| 1 | `create` + immediate `tabs.discard` is not lazy and may reject; use `suspended.html` placeholders for restore | ✓ | ✓ | ✅ Placeholder-first restore (ADR-002). `tabs.discard` only for already-open tabs (suspension). |
| 2 | Route all canonical mutations through serialized service-worker commands; UI reads only | ✓ | ✓ | ✅ (ADR-003). UI keeps optimistic local signals; commits via RPC with revision + error envelope. |
| 3 | 1–2 s debounce cannot be done with `chrome.alarms` (30 s floor) | ✓ | ✓ | ✅ In-worker `setTimeout` (~750 ms) + immediate flush on `tabs.onRemoved`/`windows.onRemoved` + 1-min alarm as safety net. |
| 4 | Journal in `storage.session` doesn't survive restart/update; need durable, resumable per-window switch record | ✓ | ✓ | ✅ `op:switch:<windowId>` in `storage.local`, state machine, replayed at `onStartup`/`onInstalled`. |
| 5 | Autosave events during a switch corrupt snapshots → mutex | ✓ | ✓ | ✅ TabTracker ignores windows with an in-flight op; full re-snapshot after commit. |
| 6 | `rt:windows` (window→workspace) must persist and be reconciled after restart (window ids change) | – | ✓ | ✅ `windows:<id>` in `storage.local` + startup reconciliation by placeholder hints and URL-set similarity. |
| 7 | Split `workspace:<id>` into meta and tabs keys | keep 1 key | ✓ split | ✅ Split: `ws:meta:<id>`, `ws:tabs:<id>`. Small metadata writes never rewrite tab lists. |
| 8 | Clean-shutdown flag is unreliable; keep recovery generations; never overwrite with empty startup state | ✓ | – | ✅ Session generations ring (10), startup snapshot only after reconciliation, never when all windows are empty. |
| 9 | Manifest: `commands` is not a permission; commands need descriptions; placeholder page can't use inline JS (CSP) | ✓ | ✓ | ✅ Fixed in §4. |
| 10 | Raise `minimum_chrome_version` to 121 (`tabs.lastAccessed`) | 121 | 116 ok | ✅ 121 (Jan 2024; all target forks are far past it). |
| 11 | New tab override: build flavors vs single | 2 flavors | single | ➖ One codebase, two build flavors (ADR-004): default listing has **no** NTP override but the dashboard is reachable as an extension page; a second listing "Tabitat New Tab" overrides NTP. Gemini's single-build "minimal page" doesn't remove the override prompt Chrome shows, so rejected. |
| 12 | Workspace ≠ tab group; keep groups inside workspaces | ✓ | ✓ | ✅ |
| 13 | Keep WXT, Preact+signals, valibot, fuzzysort, Biome | ✓ | ✓ | ✅ Keep. valibot validates persisted records and RPC payloads too. |
| 14 | Text ban on `fetch(` is unenforceable | ✓ | – | ✅ Enforce with production CSP `connect-src 'none'` in `extension_pages` (dev build keeps HMR). |
| 15 | Incognito excluded; protected URL schemes policy; URL allowlist on import/placeholder | ✓ | ✓ | ✅ §10. |
| 16 | Auto-suspension default **off** | ✓ | – | ✅ Off by default; onboarding offers it. |
| 17 | Stable ids for saved tabs/groups; one live owner window per workspace; pinned-tab policy; restore limits | ✓ | – | ✅ §6 / §5.3. |
| 18 | Undo for deletes, backup reminders, recovery screen | ✓ | – | ✅ Trash with 30-day retention (Phase 3), recovery screen (Phase 2), reminder (Phase 4). |
| 19 | Move session guard, export/import, migrations, failure handling into Phase 1; add browser spike | ✓ | ✓ | ✅ Phases reordered (§11). Spike is Phase 1a. |
| 20 | Rewrite perf budgets as measured p95 targets; 500 ms switch unproven | ✓ | – | ➖ Budgets kept as *targets*, marked unmeasured until Phase 1a spike; CI gate added in Phase 4. |
| 21 | "Panic button" Markdown/HTML export | – | ✓ | ➖ JSON export in Phase 1; HTML/Markdown list export in Phase 4. |
| 22 | Push todos/notes/pomodoro later | – | ✓ | ✅ Dashboard widgets are Phase 4. |
| 23 | Fork capability matrix (Brave/Edge/Arc/Vivaldi/Opera) | ✓ | – | ✅ `docs/COMPATIBILITY.md`, filled in Phase 5. |
| 24 | Replace "synchronous-enough" wording with explicit async consistency model | ✓ | – | ✅ §5.1 rewritten. |
