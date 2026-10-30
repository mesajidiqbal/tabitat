# Tabitat — Architecture, Design & Tech Stack (v0 draft)

Status: DRAFT for review (Codex + Gemini). Date: 2026-10-30.

## 1. Vision

Tabitat is a fast, lightweight, open-source (MIT) browser extension for all
Chromium-based browsers (Chrome, Edge, Brave, Arc, Vivaldi, Opera) that
combines the most-used features of **Workona** (workspaces, auto-saved
sessions, tab search, tab suspension) and **Manganum** (sidebar + new-tab
dashboard with todos, notes, quick links, pomodoro) — with **no account, no
server, no telemetry**. All data stays in the browser.

Guiding principles, in priority order:

1. **Local-first & private.** Zero network requests by default. No host
   permissions. No analytics.
2. **Fast.** Hard performance budgets (section 9). Nothing blocks the
   service worker start-up; UI surfaces paint from cached state.
3. **Lightweight.** Small bundles, few dependencies, no runtime CSS-in-JS,
   no heavy state libraries.
4. **Resilient.** Manifest V3 service workers are killed at will; every
   piece of state survives a restart. Users must never lose tabs.
5. **Simple to contribute to.** One language (TypeScript), one framework,
   one lint/format tool, pure domain logic testable without a browser.

## 2. Scope

### 2.1 v1.0 features (MVP)

Workona-derived:

- **Workspaces** — named, colored, ordered groups of tabs. One active
  workspace per window. Switching saves the current window's tabs into the
  outgoing workspace, closes them, and restores the incoming workspace's
  tabs *lazily* (not loaded until focused).
- **Auto-save** — every tab change (create/update/move/remove/attach/
  detach) updates the active workspace's snapshot (debounced).
- **Saved links ("resources")** per workspace — persistent links that
  are not open tabs (drag a tab there to "park" it).
- **Universal search** — fuzzy search across open tabs, workspace tabs,
  saved links, and recently closed; opened via popup, side panel, new tab,
  or keyboard shortcut.
- **Tab suspension** — auto-discard inactive tabs after N minutes
  (`chrome.tabs.discard`), with exclusions (pinned, audible, whitelist
  domains, form-input tabs where detectable). Manual "suspend others".
- **Session safety net** — periodic snapshot of all windows (ring buffer),
  "Restore previous session" after crash/update, recently closed list.
- **Duplicate tab detection** — badge + one-click close duplicates.
- **Keyboard shortcuts** — open search, next/prev workspace, suspend
  current/others, open side panel (defined in `commands`, user-remappable
  via `chrome://extensions/shortcuts`).

Manganum-derived:

- **Side panel** (`chrome.sidePanel`) — workspaces list, tab list, search,
  todos, notes, pomodoro. Stays open across tabs ("pin mode" is native).
- **New tab dashboard** (optional, toggleable) — clock/greeting, search
  box (default browser search engine via `chrome.search`), quick links
  grid, workspace switcher, todos, notes, pomodoro, theme/wallpaper
  (local color/gradient; optional user-uploaded image stored in
  IndexedDB).
- **Todos** — global and per-workspace lists, simple (text, done, order).
- **Notes** — global and per-workspace plain-text/markdown-lite notes.
- **Pomodoro** — timer with notifications (`chrome.alarms` +
  `chrome.notifications`), runs in the service worker so it survives UI
  close.

Cross-cutting:

- **Export/Import** JSON backup (all data) — the privacy-friendly
  alternative to cloud sync.
- **Optional settings sync** via `chrome.storage.sync` (settings only,
  never tab data; disabled by default).
- Light/dark/system theme; keyboard-navigable; i18n-ready (`_locales`).

### 2.2 Explicitly out of scope for v1

- Accounts, cloud sync, team sharing, cloud backups.
- Gmail / Google Calendar / Drive / Slack / Asana / Todoist integrations
  (these need OAuth + host permissions and are the main privacy/bloat
  complaints about Workona & Manganum). A later, opt-in "integrations"
  surface may embed third-party sites in the side panel via iframe where
  the site allows it.
- AI features. SMS sync. Mini-games.
- Firefox/Safari builds (WXT keeps the door open; v1 targets Chromium).

## 3. Tech stack

| Concern | Choice | Why |
|---|---|---|
| Language | TypeScript 5.x, `strict`, ESM | Type-safe messaging and storage schemas. |
| Build / extension framework | **WXT** (Vite-based) | MV3-native, auto-manifest from entrypoints, HMR for popup/sidepanel/newtab, cross-browser builds, `wxt zip` for store upload, `fake-browser` for unit tests. More actively maintained than CRXJS. |
| UI | **Preact 10 + `@preact/signals`** | ~4 KB runtime, React-compatible mental model and ecosystem, signals give fine-grained updates without a store library. |
| Styling | Plain CSS with CSS custom properties (design tokens), CSS modules via Vite | Zero runtime cost; theming via `[data-theme]` on `<html>`. No Tailwind: keeps bundles and contributor tooling small. |
| Storage | `chrome.storage.local` (+ `unlimitedStorage`) for all structured data; `chrome.storage.session` for runtime maps; IndexedDB (`idb`, 1 KB) only for blobs (wallpapers, favicon cache) | storage.local is synchronous-enough, SW-safe, and has `onChanged` for free cross-surface reactivity. |
| Schema validation | **valibot** (tree-shakable, ~1–2 KB used) | Validate imports and migrated data; TS types derived from schemas. |
| Fuzzy search | **fuzzysort** (~3 KB) | Fast, tiny, good ranking for titles/URLs. |
| IDs | `crypto.randomUUID()` | Built-in. |
| Testing | Vitest + `wxt/testing` fake browser (unit/integration); Playwright with persistent context for E2E on the built extension | Domain logic is pure and unit-tested; browser behavior tested end to end. |
| Lint / format | **Biome** | One fast tool for both; no ESLint/Prettier config sprawl. |
| Package manager | npm (lockfile committed) | Already available; no extra toolchain for contributors. |
| CI/CD | GitHub Actions: lint → typecheck → test → build → zip artifact; tag → GitHub Release with zip; optional Chrome Web Store upload via `wxt submit` | Reproducible releases. |
| Versioning | SemVer, Conventional Commits, `CHANGELOG.md` | Store listing + release notes derive from it. |

Bundle targets: Preact + signals + valibot + fuzzysort + idb ≈ 15 KB gz of
third-party code. No other runtime dependencies without an ADR.

## 4. Manifest (MV3)

```jsonc
{
  "manifest_version": 3,
  "name": "Tabitat",
  "minimum_chrome_version": "116",      // sidePanel API, tabs.discard stable
  "permissions": [
    "tabs", "tabGroups", "storage", "unlimitedStorage", "sidePanel",
    "alarms", "sessions", "favicon", "notifications", "search", "commands"
  ],
  "optional_permissions": ["bookmarks"],   // import bookmarks → quick links (opt-in)
  "host_permissions": [],                  // none, ever, by default
  "background": { "service_worker": "background.js", "type": "module" },
  "action": { "default_popup": "popup.html" },
  "side_panel": { "default_path": "sidepanel.html" },
  "chrome_url_overrides": { "newtab": "newtab.html" },
  "commands": {
    "open-search":        { "suggested_key": { "default": "Ctrl+Shift+K", "mac": "Command+Shift+K" } },
    "next-workspace":     { "suggested_key": { "default": "Ctrl+Shift+Period", "mac": "Command+Shift+Period" } },
    "prev-workspace":     { "suggested_key": { "default": "Ctrl+Shift+Comma",  "mac": "Command+Shift+Comma" } },
    "suspend-other-tabs": {}
  }
}
```

Notes:
- `tabs` is required for URLs/titles of all tabs (unavoidable for a tab
  manager); it is the only "sensitive" permission and is explained in
  onboarding and the store listing.
- `favicon` permission gives `chrome-extension://<id>/_favicon/?pageUrl=…`
  without storing favicons ourselves.
- `chrome_url_overrides.newtab` is bundled, but the dashboard honors a
  user setting: when disabled, the new tab page immediately redirects to
  `chrome://new-tab-page`? — *Not possible from an extension page.* So the
  new-tab override must be a **separate build flavor** (`tabitat` vs
  `tabitat-newtab`) or we ship it and let users disable it from
  `chrome://extensions`. **Decision requested from reviewers** — see §12.

## 5. Runtime architecture

```
┌───────────────────────── UI surfaces (Preact) ─────────────────────────┐
│  popup.html   sidepanel.html   newtab.html   options.html  suspended.html │
│         └── shared components, hooks, stores (signals) ──┘              │
└───────────────▲──────────────────────────────┬─────────────────────────┘
                │ chrome.storage.onChanged      │ typed RPC (runtime.sendMessage)
                │ (read model, reactive)        ▼ (commands only)
┌─────────────────────── background service worker ───────────────────────┐
│  TabTracker        WorkspaceEngine     Suspender      SessionGuard      │
│  (tabs.* events →  (switch/save/      (alarms →       (periodic         │
│   snapshot queue)   restore)           discard)        snapshots,       │
│  CommandRouter     Pomodoro           BadgeUpdater     restore)         │
└───────────────────────────────┬─────────────────────────────────────────┘
                                ▼
                   Repository layer (typed, versioned)
          chrome.storage.local │ chrome.storage.session │ IndexedDB (blobs)
```

### 5.1 Read path vs write path (CQRS-lite)

- **Reads**: UI surfaces read directly from `chrome.storage.local` (fast,
  no SW round trip) and subscribe to `chrome.storage.onChanged`. This
  keeps the popup/sidepanel snappy even when the SW is asleep.
- **Writes that touch tabs/windows** (switch workspace, restore, suspend,
  close duplicates) go through the service worker as typed commands, so
  there is exactly one writer coordinating `chrome.tabs` side effects.
- **Writes that touch only data** (rename workspace, add todo, edit note)
  are performed by the UI directly via the repository layer with an
  optimistic update; the repository uses a per-key read-modify-write
  with a small in-storage version counter to detect lost updates.

### 5.2 Service worker lifecycle rules

- All `chrome.*` event listeners are registered synchronously at top level.
- No module-level mutable state is relied upon; everything needed to
  handle an event is read from `storage.session` (hot) or `storage.local`.
- Long operations (restore 40 tabs) are chunked and idempotent, with a
  journal entry in `storage.session` so an SW restart mid-operation can
  resume or roll back.
- Timers use `chrome.alarms` (min 30 s on Chrome ≥ 120) — never
  `setTimeout` for anything that must survive.

### 5.3 Workspace switching algorithm (per window)

1. Read `runtime.windows[windowId].activeWorkspaceId` (session storage).
2. Snapshot current tabs → `workspaces[outgoing].tabs` (url, title,
   pinned, index, groupId/group meta, discarded flag, scroll not stored).
3. Mark journal `{ op: "switch", windowId, from, to, stage: "closing" }`.
4. Open incoming tabs **first** (so the window never hits zero tabs),
   each created `active:false` then immediately `chrome.tabs.discard()`
   (lazy-load: Chrome keeps title/favicon/URL without loading). If
   discard fails for a tab (e.g. still initializing), fall back to a
   `suspended.html?u=…&t=…` placeholder that navigates on focus.
5. Activate the tab that was active in the incoming workspace (or the
   first), close the outgoing tab IDs recorded in step 2.
6. Update `activeWorkspaceId`, clear journal, update badge/title.

Restoring Chrome **tab groups**: group color/title are stored per tab;
on restore, groups are re-created with `chrome.tabs.group` + `tabGroups.update`.

### 5.4 Tab tracking & auto-save

`tabs.onCreated/onUpdated/onMoved/onRemoved/onAttached/onDetached/
onActivated`, `tabGroups.on*`, `windows.onRemoved` → push window id into a
dirty set in `storage.session` → debounced (`alarms`, ~1–2 s via
`chrome.alarms.create` with `when`) snapshot of dirty windows into their
active workspace. A tab in a window with **no** active workspace is
tracked in an implicit, unnamed "Unsorted" workspace per window (so
nothing is ever lost and users can name it later).

### 5.5 Suspension

Alarm every minute: for each tab, if `!active && !pinned && !audible &&
!discarded && lastAccessed < now - N` and URL not whitelisted and not
`chrome://` → `chrome.tabs.discard(id)`. The user can "suspend others now"
and "never suspend this site". No content scripts are injected (so we
cannot detect unsaved form input — documented limitation; conservative
default of 30 min).

### 5.6 Session guard

Every 5 min (alarm) and on `windows.onRemoved`, write a full snapshot of
all windows into a ring buffer (last 10) in `storage.local` under
`sessions.snapshots`. On `runtime.onStartup`, if the previous shutdown was
not clean (flag in `storage.local`), set a badge and offer "Restore last
session" in popup.

## 6. Data model (storage.local)

Keys are namespaced to allow partial reads and cheap `onChanged` filtering:

```
meta                      { schemaVersion: 1, installedAt, lastCleanShutdown }
settings                  Settings
workspaces:index          string[]            // ordered ids
workspace:<id>            Workspace           // one key per workspace (small writes)
todos:<scope>             Todo[]              // scope = "global" | workspaceId
notes:<scope>             Note
quicklinks                QuickLink[]
sessions:snapshots        SessionSnapshot[]   // ring buffer
recentlyClosed            ClosedTab[]         // last 50
```

```ts
interface Workspace {
  id: string; name: string; color: Color; emoji?: string;
  createdAt: number; updatedAt: number;
  tabs: SavedTab[];           // last snapshot of open tabs
  resources: SavedLink[];     // parked links
  activeTabUrl?: string;
}
interface SavedTab { url: string; title: string; pinned: boolean; index: number;
  group?: { title: string; color: string }; }
interface SavedLink { id: string; url: string; title: string; order: number }
interface Todo { id: string; text: string; done: boolean; order: number; createdAt: number }
interface Note { content: string; updatedAt: number }
interface QuickLink { id: string; url: string; title: string; order: number }
interface Settings {
  theme: "system" | "light" | "dark";
  newTab: { enabled: boolean; widgets: WidgetId[]; wallpaper: Wallpaper };
  suspend: { enabled: boolean; afterMinutes: number; whitelist: string[]; keepPinned: boolean; keepAudible: boolean };
  sessions: { snapshotEveryMinutes: number; keep: number };
  pomodoro: { workMin: number; breakMin: number; longBreakMin: number; roundsBeforeLong: number };
  syncSettings: boolean;
}
```

`storage.session` (runtime, cleared on browser restart):

```
rt:windows        Record<windowId, { activeWorkspaceId: string | null }>
rt:dirtyWindows   number[]
rt:journal        Journal | null
rt:pomodoro       { phase, endsAt, round } | null
```

Migrations: `meta.schemaVersion` + an ordered list of pure migration
functions run once at `runtime.onInstalled`, validated with valibot.

## 7. Messaging

A tiny typed RPC (`src/messaging/`) over `chrome.runtime.sendMessage`:

```ts
type Commands = {
  "workspace.switch":  { in: { windowId: number; workspaceId: string }; out: void };
  "workspace.create":  { in: { name: string; fromWindowId?: number }; out: Workspace };
  "tabs.suspendOthers": { in: { windowId: number }; out: number };
  "tabs.closeDuplicates": { in: { windowId?: number }; out: number };
  "session.restore":   { in: { snapshotId: string }; out: void };
  "pomodoro.start" | "pomodoro.stop" | "pomodoro.skip": ...
  "search.query":      { in: { q: string; limit?: number }; out: SearchHit[] };
};
```

Each message is `{ type, payload, requestId }`; the SW validates `type`
against a map of handlers; the client gets a typed `send()` function.
Events flow back **only** through `storage.onChanged` (no push messages
from SW to UI), which removes a whole class of "port disconnected" bugs.

## 8. Code structure

```
tabitat/
├─ wxt.config.ts
├─ src/
│  ├─ entrypoints/
│  │  ├─ background.ts           # SW: registers listeners, wires services
│  │  ├─ popup/   index.html, main.tsx
│  │  ├─ sidepanel/ …
│  │  ├─ newtab/ …
│  │  ├─ options/ …
│  │  └─ suspended/ …            # placeholder page (no framework, inline)
│  ├─ core/                      # PURE: no chrome.* imports, 100% unit-tested
│  │  ├─ model/     (schemas, types, migrations)
│  │  ├─ workspace/ (snapshot diffing, switch planner → list of tab ops)
│  │  ├─ search/    (indexing + fuzzysort wrapper)
│  │  ├─ suspend/   (eligibility rules)
│  │  └─ pomodoro/  (state machine)
│  ├─ platform/                  # thin adapters over chrome.* (mockable)
│  │  ├─ storage.ts  tabs.ts  windows.ts  alarms.ts  sidepanel.ts
│  ├─ background/                # services that glue core + platform
│  │  ├─ tab-tracker.ts workspace-engine.ts suspender.ts session-guard.ts
│  │  ├─ pomodoro.ts command-router.ts badge.ts
│  ├─ messaging/                 # typed RPC
│  ├─ ui/                        # Preact shared: components, hooks, stores, theme.css
│  └─ i18n/
├─ tests/ (unit under src/**/*.test.ts; e2e/ Playwright)
├─ docs/ (ARCHITECTURE.md, ADRs, reviews/, store-listing/)
└─ .github/workflows/ci.yml, release.yml
```

The `core/` ↔ `platform/` split is the key testability decision: the
switch algorithm is a pure planner that returns a list of operations
(`[{create}, {discard}, {activate}, {remove}]`) which the engine executes.

## 9. Performance budgets (enforced in CI where possible)

| Metric | Budget |
|---|---|
| Popup: open → first meaningful paint | < 100 ms (reads 1 storage key, renders from it) |
| Side panel first paint | < 150 ms |
| New tab first paint | < 50 ms (critical CSS inline, no web fonts, no network) |
| Service worker start → first event handled | < 30 ms of our code |
| Workspace switch (20 tabs) | < 500 ms, no tab ever loads content |
| Bundle size (all surfaces, gz) | < 200 KB total; each surface < 60 KB |
| Memory: SW idle | n/a (SW sleeps); UI pages < 20 MB each |
| Storage write amplification | one write per debounce window per window |

CI uses `size-limit`-style check on `.output/` and a Playwright timing test.

## 10. Privacy & security

- No `host_permissions`, no content scripts, no remote code, CSP default.
- No network requests from any Tabitat code (favicons via the `favicon`
  permission's local endpoint). Lint rule: `fetch(`/`XMLHttpRequest`
  forbidden outside an explicit allow-list (empty in v1).
- Export file is plain JSON; import validated by valibot; URLs sanitized
  (`javascript:`/`data:` rejected for navigation).
- `suspended.html` placeholder only navigates to `http(s)`/`file`/`ftp`
  URLs it was created with.

## 11. Delivery phases

| Phase | Deliverable | Review gate |
|---|---|---|
| 0 | This document + ADRs 001-004; repo scaffold (WXT, Biome, Vitest, CI) | Codex + Gemini design review |
| 1 | Core domain (`core/`), repository + migrations, TabTracker, WorkspaceEngine (switch/save/restore), minimal popup to drive it | Review + unit tests ≥ 90 % on core |
| 2 | Popup + side panel UI: workspaces CRUD, tab list, universal search, saved links, shortcuts, badge | Review + Playwright smoke |
| 3 | New tab dashboard: clock, search, quick links, workspace switcher, todos, notes, pomodoro, theme/wallpaper, widget toggles; options page | Review |
| 4 | Suspension, session guard, duplicate detection, recently closed, export/import, settings sync | Review + perf budget check |
| 5 | Onboarding, a11y pass, i18n, icons/store assets, README/CONTRIBUTING, release workflow, v1.0.0 tag + zip | Final review |

Each phase ends at a git tag (`phase-N`) = resumable checkpoint.

## 12. Open questions for reviewers

1. **New tab override**: ship as one extension (override always present,
   user can disable in `chrome://extensions`) or two build flavors? Is
   there a trick to defer to the default NTP when disabled?
2. **Lazy restore**: `tabs.create` + immediate `tabs.discard` vs. our own
   `suspended.html` placeholder. Which is more reliable across Chromium
   forks (Brave/Edge/Arc)? Any known issue with discarding a tab that
   hasn't finished its first navigation?
3. **Preact + signals vs. Solid vs. Svelte 5** for the smallest, fastest
   UI with 4 surfaces sharing components. Any strong reason to change?
4. **Storage layout**: one key per workspace vs. a single `workspaces`
   blob. Does `storage.local` per-key granularity help or hurt at 50
   workspaces × 50 tabs?
5. **Direct UI writes** (CQRS-lite, §5.1) vs. all writes through the SW.
   Is the lost-update risk real in practice given `storage.local` is
   serialized per extension?
6. **Tab groups**: should a workspace *be* a Chrome tab group (keep all
   workspaces open, collapse inactive) as an alternative mode? Memory vs.
   fidelity trade-off.
7. Anything in the MV3 lifecycle plan (§5.2) that is naive?
8. Is `minimum_chrome_version: 116` acceptable for the target browsers?
