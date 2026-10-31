# Tabitat — Architecture, Design & Tech Stack

Status: **v1 (finalized after Codex + Gemini review)** — 2026-10-30.
Review history: `docs/reviews/phase0-*.md`, decisions in
`docs/reviews/phase0-triage.md`, ADRs in `docs/adr/`.

## 1. Vision

Tabitat is a fast, lightweight, open-source (MIT) extension for all
Chromium-based browsers (Chrome, Edge, Brave, Arc, Vivaldi, Opera) that
combines the most-used features of **Workona** (workspaces, auto-saved
sessions, universal tab search, tab suspension) and **Manganum** (side panel
+ new-tab dashboard with todos, notes, quick links, pomodoro) — with **no
account, no server, no telemetry**. All data stays in the browser.

Principles, in priority order:

1. **Never lose a tab.** Every destructive browser operation is journaled,
   resumable, and recoverable. Recovery is tested with injected failures.
2. **Local-first & private.** Zero network requests (enforced by CSP), no
   host permissions, no content scripts, no analytics.
3. **Fast.** Performance targets in §9; UI surfaces paint from storage
   without waiting for the service worker.
4. **Lightweight.** ~15 KB gz of third-party runtime code; no runtime
   CSS-in-JS; no state library beyond signals.
5. **Simple to contribute to.** One language, one framework, one lint tool;
   pure domain logic testable without a browser.

## 2. Scope

### 2.1 v1.0 features

Workona-derived
- **Workspaces**: named, colored, ordered sets of tabs. A workspace is
  *open* in at most one window at a time (one live owner window). Each
  window has at most one active workspace. Switching saves the outgoing
  workspace, closes its tabs, and opens the incoming workspace's tabs as
  lightweight placeholders that load on focus.
- **Auto-save**: tab create/update/move/remove/attach/detach/group events
  update the active workspace's snapshot (debounced in-worker, flushed
  immediately on removal events).
- **Saved links** per workspace (parked links that are not open tabs).
- **Universal search**: fuzzy search over open tabs, all workspace tabs,
  saved links, quick links, recently closed. From popup, side panel,
  dashboard, or shortcut.
- **Tab suspension** (opt-in, default off): discard inactive tabs after N
  minutes with exclusions (pinned, audible, whitelisted hosts). Manual
  "suspend others".
- **Session safety net**: periodic generations of all windows (ring of
  10), "recover previous session" screen, recently closed (last 50).
- **Duplicate tab detection** and one-click close.
- **Keyboard shortcuts** via `commands` (search, next/prev workspace,
  suspend others, toggle side panel); user-remappable.

Manganum-derived
- **Side panel** (`chrome.sidePanel`): workspaces, tab list, search,
  todos, notes, pomodoro. Persists across tabs natively.
- **Dashboard** (extension page; also the new-tab page in the
  "Tabitat New Tab" build flavor, ADR-004): clock/greeting, search box
  (`chrome.search`), quick links grid, workspace switcher, todos, notes,
  pomodoro, theme/wallpaper (color/gradient; optional local image in
  IndexedDB), widget toggles.
- **Todos** (global + per workspace), **Notes** (global + per workspace,
  plain text with light markdown rendering, no remote images).
- **Pomodoro** running in the service worker (`alarms` + `notifications`).

Cross-cutting
- **Export/Import** JSON backup (validated, staged, atomic).
- **Trash** for deleted workspaces/links (30-day retention) + undo toast.
- Optional **settings sync** via `storage.sync` (settings only; default off).
- Light/dark/system theme, keyboard navigable, i18n-ready (`_locales`).

### 2.2 Out of scope for v1
Accounts, cloud sync/backups, team sharing, Gmail/Calendar/Drive/Slack/
Asana/Todoist integrations, AI, SMS, games, Firefox/Safari builds.

### 2.3 Known limitations (documented to users)
Closing a tab loses in-page state (scroll position, unsaved forms, history
stack). v1 restores *saved tabs* (URL, title, pinned, group), not live
state. Users are told this in onboarding; pinned tabs are never closed by a
switch (they belong to the window, not the workspace).

## 3. Tech stack

| Concern | Choice | Why |
|---|---|---|
| Language | TypeScript 5.x `strict`, ESM | Typed storage records, RPC, and ops. |
| Build / framework | **WXT 0.21** (Vite) | MV3-native, manifest from entrypoints, HMR, `wxt zip`, `wxt/testing` fake browser, cross-browser later. |
| UI | **Preact 10 + `@preact/signals`** | ~4 KB, React ecosystem, fine-grained reactivity. |
| Styling | Plain CSS, CSS custom properties, CSS modules | Zero runtime; theming via `[data-theme]`. |
| Storage | `chrome.storage.local` (+`unlimitedStorage`) for all records and ops journal; `storage.session` only for caches that may be lost; IndexedDB (`idb`) for blobs | `onChanged` gives free cross-surface reactivity; local is durable across SW restarts, reloads, updates. |
| Validation | **valibot** | Validates persisted records, imports, migrations, and RPC payloads. |
| Search | **fuzzysort** | Index built once per surface session, updated incrementally on `onChanged`; never rebuilt per keystroke. |
| Testing | Vitest + `wxt/testing/fake-browser`; Playwright (persistent context, built extension) for E2E; failure-injection harness around every destructive op | Core is pure; recovery is tested, not assumed. |
| Lint/format/types | **Biome** + `tsc --noEmit` | One fast tool + the compiler. |
| Package manager | npm, lockfile committed | Available everywhere. |
| CI/CD | GitHub Actions: lint → typecheck → unit → build (both flavors) → size check → E2E smoke → zip artifacts; tag → GitHub Release | Reproducible. |
| Versioning | SemVer, Conventional Commits, CHANGELOG | |

## 4. Manifest (MV3)

```jsonc
{
  "manifest_version": 3,
  "name": "Tabitat",
  "minimum_chrome_version": "121",        // tabs.lastAccessed, sidePanel, tabs.discard
  "permissions": ["tabs","tabGroups","storage","unlimitedStorage","sidePanel",
                  "alarms","favicon","notifications","search"],
  "optional_permissions": ["bookmarks"],  // import bookmarks → quick links
  "host_permissions": [],
  "background": { "service_worker": "background.js", "type": "module" },
  "action": { "default_popup": "popup.html", "default_title": "Tabitat" },
  "side_panel": { "default_path": "sidepanel.html" },
  "options_ui": { "page": "options.html", "open_in_tab": true },
  // "chrome_url_overrides": { "newtab": "dashboard.html" }  ← only in the newtab flavor
  "commands": {
    "open-search":        { "description": "Search tabs and workspaces", "suggested_key": { "default": "Ctrl+Shift+K", "mac": "Command+Shift+K" } },
    "next-workspace":     { "description": "Switch to next workspace",   "suggested_key": { "default": "Ctrl+Shift+Period", "mac": "Command+Shift+Period" } },
    "prev-workspace":     { "description": "Switch to previous workspace", "suggested_key": { "default": "Ctrl+Shift+Comma", "mac": "Command+Shift+Comma" } },
    "suspend-other-tabs": { "description": "Suspend all other tabs in this window" },
    "toggle-side-panel":  { "description": "Open the Tabitat side panel" }
  },
  "content_security_policy": {
    "extension_pages": "script-src 'self'; object-src 'none'; connect-src 'none'; img-src 'self' data: chrome-extension:; style-src 'self'"
    // dev builds relax connect-src for HMR only
  },
  "incognito": "not_allowed"
}
```

- `tabs` is the only sensitive permission (needed for URLs/titles); it is
  explained in onboarding and the store listing.
- `connect-src 'none'` makes "no network" a browser-enforced guarantee for
  all extension pages and the service worker in production builds.
- `incognito: not_allowed` → incognito windows are never tracked.
- `suspended.html` ships a tiny external script (no inline JS, CSP).

## 5. Runtime architecture

```
┌──────────────────────── UI surfaces (Preact) ──────────────────────────┐
│ popup · sidepanel · dashboard(newtab) · options · recovery · suspended  │
│   read model: storage.local + onChanged → signals (no SW round trip)    │
└───────────────▲─────────────────────────────┬──────────────────────────┘
                │ onChanged (read)             │ typed RPC commands (write)
┌───────────────┴─────────── service worker ──▼──────────────────────────┐
│ CommandRouter (serialized per window / per key)                        │
│ TabTracker · WorkspaceEngine (op state machine) · SessionGuard         │
│ Suspender · Pomodoro · Badge · Reconciler (startup)                    │
└───────────────────────────────┬────────────────────────────────────────┘
                                ▼
                 Repository (typed, versioned, validated)
        storage.local (records + ops journal) · storage.session (caches) · IDB (blobs)
```

### 5.1 Consistency model
- **Reads** are asynchronous snapshots of `storage.local`; UIs render the
  last snapshot and re-render on `onChanged`. Reads never block on the SW.
- **All canonical writes** go through the service worker (ADR-003). The
  CommandRouter serializes handlers per *lane* (`window:<id>` for tab
  operations, `key:<storageKey>` for record edits) so read-modify-write
  of a given key never interleaves. Each record carries `rev`; a command
  may pass `expectedRev` and receives `{ ok:false, code:"conflict" }` if
  stale. Handlers ack only after `storage.local.set` resolves.
- **Optimistic UI**: surfaces may update local signals immediately and
  reconcile on the `onChanged` echo or on an error envelope.
- `storage.local` is *not* transactional across keys. Multi-key changes
  are expressed as an **op record** written first (intent), then applied,
  then the op record is deleted (commit). Anything that reads a key with
  a pending op must treat the op as the source of truth.

### 5.2 Service-worker lifecycle rules
- All `chrome.*` listeners are registered synchronously at module top level.
- No handler depends on module state. Hot caches live in `storage.session`
  and are rebuildable from `storage.local` + `chrome.tabs.query`.
- **Init barrier**: every handler awaits `ready()` which runs once per SW
  life: migrations (resumable), ops-journal replay, window reconciliation,
  alarm repair (`alarms.getAll` → recreate missing).
- Durable timing uses `chrome.alarms` (≥ 30 s; Chrome only enforces the
  floor on packaged installs — spike S5 — so the code never asks for less).
  Short debounces use
  in-worker `setTimeout` **plus** a durable "dirty" marker so a killed
  worker still flushes on next wake (alarm `flush-dirty` every 1 min).
- Long operations are chunked (≤ 10 tab ops per chunk) and each chunk
  advances the op record, so a mid-op restart resumes at the right stage.

### 5.3 Workspace switch: durable state machine (per window)

Op record `op:switch:<windowId>` in `storage.local`:

```ts
interface SwitchOp {
  id: string; windowId: number; from: string | null; to: string;
  stage: "snapshot" | "opening" | "activating" | "closing" | "done";
  outgoingTabIds: number[];          // real ids captured at snapshot
  createdTabIds: number[];           // placeholders created so far
  incoming: SavedTab[];              // frozen copy of target tabs
  startedAt: number; attempts: number;
}
```

Invariants: (I1) the window never has zero tabs; (I2) the outgoing
workspace's snapshot is written **before** any tab is closed; (I3) tab ids
are never persisted as workspace data (only inside the op record and only
for the current browser session; note `tabs.discard` **replaces the tab
id** — spike S11 — so the engine listens to `tabs.onReplaced`); (I4) TabTracker ignores a window while
its op record exists; (I5) at most one op per window; a second request
gets `busy`.

Stages:
1. `snapshot` — `tabs.query({windowId})`; write `ws:tabs:<from>` (non-pinned
   tabs only; pinned tabs stay in the window); record `outgoingTabIds`.
2. `opening` — for each incoming SavedTab, create a tab in chunks:
   - `http(s)`/`file`/`ftp` → `suspended.html#u=<url>&t=<title>&w=<wsId>&s=<savedTabId>`
     (placeholder; loads the real URL on activation — ADR-002; spike S1/S2/S4:
     zero target fetches, 20-tab switch p95 ≈ 130 ms, hashes survive restart.
     Activation in an occluded window may not fire `visibilitychange`, so the
     engine never assumes "activated ⇒ loaded"; click/keypress is the fallback).
   - `chrome://`, `about:` (plus `edge://` on Edge, `brave://` on Brave —
     detected at runtime from `navigator.userAgentData.brands`) → created
     directly (cannot be wrapped; they are cheap). Another browser's
     internal scheme yields an empty tab (spike S13) and is skipped.
   - `chrome-extension://` of other extensions, `devtools://`, `javascript:`,
     `data:` → skipped and listed in the op result ("could not restore").
   Re-create tab groups (`tabs.group` + `tabGroups.update`).
3. `activating` — activate the saved active tab (or first); set
   `windows:<id>.activeWorkspaceId = to`.
4. `closing` — remove `outgoingTabIds` **one id at a time** (spike S7: a
   batched `tabs.remove` rejects on a stale id *after* removing the valid
   ones); a "No tab with id" rejection counts as done. Tabs whose URL
   cannot be restored (other extensions' pages, devtools) are *retained*:
   neither saved nor closed, like pinned tabs. Empty target workspace → create one `newtab` placeholder
   first (I1).
5. `done` — delete the op record; full re-snapshot of the window into
   `ws:tabs:<to>`; badge update.

Replay on SW start: if an op record exists, resume from its stage using
`createdTabIds`/`outgoingTabIds` after verifying each id still exists in
this window; if the browser restarted (ids invalid), discard the op, mark
the window for reconciliation, and show the recovery screen offering the
frozen `incoming` list and the saved `from` snapshot. Nothing is deleted.

### 5.4 Tab tracking & auto-save
Events → `TabTracker.markDirty(windowId)` → in-worker 750 ms debounce →
`snapshotWindow()` (skips windows with an op record; incognito never
appears due to `incognito: not_allowed`). `tabs.onRemoved` and
`windows.onRemoved` flush immediately. A durable `dirty:<windowId>` key is
written on first mark; the `flush-dirty` alarm (1 min) flushes any
leftovers after a worker kill. A window with no active workspace is
tracked in an implicit per-window **Unsorted** workspace (`ws:meta` with
`kind:"unsorted"`), so nothing is lost and it can be named later.

`windows.onRemoved` also moves the window's Unsorted tabs into
`recentlyClosed` and keeps the named workspace intact (closed, not deleted).

### 5.5 Startup reconciliation (Reconciler)
Window ids change on browser restart. On `runtime.onStartup`/`onInstalled`:
1. `windows.getAll({populate:true})`.
2. For each window, collect placeholder hints (`w=<wsId>` from
   `suspended.html` tabs) and the URL set. Match to a workspace by
   (a) majority placeholder hint, else (b) highest Jaccard similarity of
   URL sets vs `ws:tabs:*` with a 0.6 threshold, else Unsorted.
3. Write `windows:<newId>`, drop stale `windows:*` entries, ensure no
   workspace is owned by two windows (second becomes Unsorted + warning).
4. Only then take a session generation (never from an all-empty state).

### 5.6 Session guard
Alarm every 5 min + `windows.onRemoved` + before each switch: write
`sessions:gen:<n>` (all windows, saved-tab form, placeholders unwrapped),
keep the last 10 via `sessions:index`. There is **no** clean-shutdown
flag; the recovery screen lists generations with timestamps and tab
counts and lets the user restore any of them into a new window.

### 5.7 Suspension (opt-in)
Alarm every 1 min when enabled: `tabs.query({active:false, pinned:false,
audible:false, discarded:false})` → eligible if `lastAccessed < now − N`
and host not whitelisted and scheme is `http(s)` → `tabs.discard` (which
returns a **new tab id**; `tabs.onReplaced` keeps TabTracker consistent). No
content scripts, so unsaved form input cannot be detected: default
**off**, suggested 30 min, documented.

## 6. Data model (`storage.local`)

```
meta                    { schemaVersion, installedAt, flavor }
settings                Settings (rev)
ws:index                string[]                       ordered workspace ids
ws:meta:<id>            { id, name, color, emoji?, kind:"named"|"unsorted", windowHint?, resources:SavedLink[], createdAt, updatedAt, rev }
ws:tabs:<id>            { tabs: SavedTab[], activeSavedTabId?, updatedAt, rev }
windows:<windowId>      { activeWorkspaceId: string|null, sessionEpoch }
op:switch:<windowId>    SwitchOp (exists only while switching)
dirty:<windowId>        number (timestamp)
sessions:index          string[]           sessions:gen:<n>  SessionGeneration
recentlyClosed          ClosedTab[] (≤ 50)
todos:<scope>           { items: Todo[], rev }        scope = global | <wsId>
notes:<scope>           { content, updatedAt, rev }
quicklinks              { items: QuickLink[], rev }
trash                   { items: TrashItem[] }       30-day retention
pomodoro                { phase, endsAt, round } | null
```

```ts
interface SavedTab { id: string; url: string; title: string; pinned: false; index: number;
                     favIconUrl?: string; group?: { id: string; title: string; color: string; collapsed: boolean } }
interface SavedLink { id: string; url: string; title: string; order: number; addedAt: number }
interface Todo      { id: string; text: string; done: boolean; order: number; createdAt: number; doneAt?: number }
interface QuickLink { id: string; url: string; title: string; order: number }
interface Settings  { theme: "system"|"light"|"dark";
  dashboard: { widgets: WidgetId[]; wallpaper: { kind:"color"|"gradient"|"image"; value: string } };
  suspend: { enabled: boolean; afterMinutes: number; whitelist: string[] };
  sessions: { everyMinutes: number; keep: number };
  pomodoro: { workMin: number; breakMin: number; longBreakMin: number; roundsBeforeLong: number };
  syncSettings: boolean; restoreLimit: number /* max tabs per switch, default 100 */ }
```

Every record has a valibot schema. `meta.schemaVersion` + ordered pure
migrations run inside the init barrier; each migration writes
`migration:<n>` progress so an interrupted one resumes. Imports are
validated, written to `import:staging`, then swapped in one `set` of the
final keys.

## 7. Messaging (typed RPC)

```ts
type Envelope<T> = { ok: true; value: T } | { ok: false; code: RpcError; message: string; retryable: boolean };
type RpcError = "conflict" | "busy" | "not_found" | "invalid" | "limit" | "internal";

type Commands = {
  "workspace.create":   { in: { name: string; color: Color; fromWindowId?: number }; out: WorkspaceMeta };
  "workspace.update":   { in: { id: string; patch: Partial<WorkspaceMeta>; expectedRev: number }; out: WorkspaceMeta };
  "workspace.delete":   { in: { id: string }; out: { trashId: string } };
  "workspace.switch":   { in: { windowId: number; workspaceId: string }; out: { skipped: SavedTab[] } };
  "workspace.open":     { in: { workspaceId: string; newWindow: true }; out: { windowId: number } };
  "tabs.park":          { in: { tabId: number; workspaceId: string }; out: void };
  "tabs.suspendOthers": { in: { windowId: number }; out: number };
  "tabs.closeDuplicates": { in: { windowId?: number }; out: number };
  "session.restore":    { in: { generation: number; into: "new-window" }; out: void };
  "backup.export":      { in: {}; out: BackupFile };
  "backup.import":      { in: { file: unknown; mode: "replace"|"merge" }; out: ImportReport };
  "todo.*" | "note.*" | "quicklink.*" | "settings.*" | "pomodoro.*" | "trash.*": ...
  "op.status":          { in: { windowId: number }; out: SwitchOp | null };
};
```

Messages are `{ type, payload, requestId }`; the router validates payloads
with valibot, de-duplicates `requestId` for 30 s (idempotent retries),
and runs the handler in its lane. Events flow back only through
`storage.onChanged` (no SW → UI push).

## 8. Code structure

```
src/
├─ entrypoints/
│  ├─ background.ts                 SW: listeners + ready() barrier
│  ├─ popup/ sidepanel/ dashboard/ options/ recovery/   (Preact)
│  └─ suspended/  index.html + main.ts (framework-free, external script)
├─ core/            PURE (no chrome.*): model/schemas+migrations, ops/switch-planner,
│                   search/, suspend/rules, pomodoro/machine, reconcile/matcher
├─ platform/        thin adapters: storage, tabs, windows, tabGroups, alarms, sidePanel, notifications
├─ background/      services: command-router, tab-tracker, workspace-engine, session-guard,
│                   reconciler, suspender, pomodoro, badge
├─ messaging/       rpc client + server, Commands types, envelopes
├─ ui/              shared components, hooks (useStorageKey), stores (signals), theme.css
└─ i18n/
tests/e2e/          Playwright: switch, restart-during-switch, restore, import
```

`core/ops/switch-planner` is a pure function `(window, target, settings)
→ SwitchOp + Plan[]`; the engine executes plans, which makes every
failure scenario unit-testable by replaying stages.

## 9. Performance targets (unmeasured until Phase 1a; CI gate from Phase 4)

| Metric | Target (p95) |
|---|---|
| Popup open → first paint | < 100 ms |
| Side panel first paint | < 150 ms |
| Dashboard first paint | < 50 ms (critical CSS inline, no web fonts) |
| SW event → our handler entered | < 30 ms after `ready()` |
| Workspace switch, 20 tabs | < 500 ms, zero page loads |
| Bundles (gz) | each surface < 60 KB; total < 200 KB |
| Storage writes | ≤ 1 write per window per debounce window |

## 10. Privacy & security
- No `host_permissions`, no content scripts, no remote code; production
  CSP `connect-src 'none'`.
- `incognito: not_allowed`.
- URL policy: placeholders unwrap only `http(s)`/`file`/`ftp`; imports
  reject `javascript:`/`data:`/`vbscript:`; notes render no remote images.
- Favicons via the `favicon` permission's local endpoint only.
- `storage.sync` carries settings only; never tabs, notes, or todos.
- Backup files are plain JSON; import validated and staged (§6).

## 11. Delivery phases

| Phase | Deliverable | Gate |
|---|---|---|
| 0 | This doc, ADR-001…004, triage, repo scaffold (WXT, Preact, Biome, Vitest, Playwright, CI), tag `phase-0` | Codex + Gemini review ✔ |
| 1a | **Browser spike**: placeholder restore, alarm floor, SW kill mid-switch, `commands` activation, side panel open from popup. Results → `docs/SPIKE.md`; adjust §5 if needed | measured |
| 1 | `core/` (schemas, migrations, switch planner, matcher), repository, CommandRouter, TabTracker, WorkspaceEngine, Reconciler, SessionGuard, export/import, dev popup to drive it; failure-injection tests around every destructive op | Codex + Gemini review; unit ≥ 90 % on core; injected-failure suite green |
| 2 | Popup + side panel: workspaces CRUD, tab list, universal search, saved links, recently closed, recovery screen, shortcuts, badge | Review; Playwright smoke |
| 3 | Suspension, duplicate detection, trash/undo, options page, settings sync, bookmarks import | Review |
| 4 | Dashboard + newtab flavor: clock, search, quick links, todos, notes, pomodoro, theme/wallpaper, widget toggles; HTML export; backup reminder; perf CI gate | Review; budgets measured |
| 5 | Onboarding, a11y, i18n, icons/store assets, `COMPATIBILITY.md` (fork matrix), README/CONTRIBUTING, release workflow, v1.0.0 | Final review |

Each phase ends at a git tag `phase-N` (resumable checkpoint) and an
update to `docs/PROGRESS.md`.

## 12. Decisions on the v0 open questions
See `docs/reviews/phase0-triage.md` rows 11, 1, 13, 7, 2, 12, 4/5/8, 10.
