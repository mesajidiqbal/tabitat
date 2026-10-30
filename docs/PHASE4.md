# Phase 4 spec — dashboard + new-tab flavor, HTML export, backup reminder, perf gate

Builds on `docs/ARCHITECTURE.md` (§2.1 Manganum-derived, §9, §11), ADR-004 (new-tab
flavor), `docs/UI-SPEC.md` (tokens, keyboard rules, i18n) and `docs/PHASE3.md`.
Additive to every existing contract. Rules still hold: UI never writes
`chrome.storage`; saved state changes go through `send()`; strings via `t()`;
no network; keyboard first; `src/core` pure.

One explicit exception, documented here: the dashboard may write the
wallpaper **image blob** to IndexedDB (`idb`, database `tabitat`, store
`blobs`, key `wallpaper`) directly. It is device-local media, never synced,
never part of a backup; the canonical setting (`dashboard.wallpaper =
{ kind: "image", value: "idb:wallpaper" }`) still goes through
`settings.update`.

## 1. Contract additions (done in the main tree first)

### Model (`src/core/model/types.ts`)

- `Settings.backupReminderDays: number` — default 30, `0` = off (schema: int ≥ 0 ≤ 365).
- `Meta.lastBackupAt?: number` — set by the worker whenever a backup (JSON or
  HTML) is produced through a command.

### Commands (`src/messaging/commands.ts`)

| Command | in | out | Lane | Notes |
|---|---|---|---|---|
| `backup.exportHtml` | `{ stripQuery?: boolean }` | `{ html: string; filename: string }` | `*`-free read (`key:meta` for the stamp) | Netscape bookmark HTML of all workspaces (tabs + saved links as a sub-folder) and quick links. Records `meta.lastBackupAt`. |
| `session.exportHtml` | `{ generation: number; stripQuery?: boolean }` | `{ html: string; filename: string }` | read | Same format for one session generation (one folder per window). Does not touch `lastBackupAt`. |
| `reminder.snooze` | `{ days: number }` | `null` | `global` | Writes `backup:reminder.snoozedUntil = now + days`. |

`backup.export` (existing) also records `meta.lastBackupAt`.

### Storage keys

- `backup:reminder` (storage.local, background-owned): `{ dueSince: number; snoozedUntil?: number }`.
  Written by the daily alarm `backup-reminder` (period 1440 min, created when
  `backupReminderDays > 0`, cleared when 0) when
  `now - (meta.lastBackupAt ?? meta.installedAt) > backupReminderDays` days
  and not snoozed; removed when a backup is recorded or the setting is 0.
- IndexedDB `tabitat/blobs` (UI-owned, see exception above).

## 2. HTML export (`src/core/export/html.ts`, pure)

Netscape Bookmark File Format so every browser's bookmark manager can import
it:

```
<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Tabitat export</TITLE>
<H1>Tabitat export — 2026-10-31</H1>
<DL><p>
  <DT><H3 ADD_DATE="…">Work</H3>
  <DL><p>
    <DT><A HREF="https://…" ADD_DATE="…">Title</A>
    <DT><H3>Saved links</H3><DL><p>…</DL><p>
  </DL><p>
  <DT><H3>Quick links</H3><DL><p>…</DL><p>
</DL><p>
```

- `buildHtmlExport(input, { now, stripQuery })` where `input` is
  `{ workspaces: Array<{ meta, tabs, links }>, quicklinks }` or
  `{ generation }`; escapes `&<>"`; skips non-restorable URLs (`classifyUrl === "skip"`);
  `stripQuery` removes `?query` and `#fragment` (privacy option from the
  Phase 1 triage); pinned tabs included; placeholder URLs unwrapped.
- Filename `tabitat-YYYY-MM-DD.html` / `tabitat-session-<n>-YYYY-MM-DD.html`.
- UI: recovery page Data section and options Data section get "Export HTML"
  with a "Strip query strings" checkbox; sessions list gets "Export HTML" per
  generation (replaces the Phase 3 "Export backup" label there, which stays
  on the Data section).

## 3. Backup reminder

- Options → Data: "Remind me to back up every N days" (0 = off; 7–365).
- `BackupBanner` (src/ui/sections/BackupBanner.tsx) reads `backup:reminder`
  and `meta`: "Last backup N days ago · Export · Remind me in a week · Turn
  off". Export → `backup.export` download (existing helper); snooze →
  `reminder.snooze { days: 7 }`; off → `settings.update { backupReminderDays: 0 }`.
  Rendered in the popup (below RecoveryBanner), options Data section and
  (post-review pass) the dashboard.

## 4. Dashboard (`src/entrypoints/dashboard`, also the NTP in the newtab flavor)

Layout (max 1100 px, centered, 24 px gutters, responsive 1–3 columns, phone
width works): top row **Clock** (time, date, greeting by hour, no name) and
**Search**; then a grid of widget cards in `settings.dashboard.widgets`
order; a ⚙ "Customize" button (top-right) opens a panel with **widget
toggles** (checkbox list, drag or ▲▼ reorder), **theme** (system/light/dark)
and **wallpaper** (8 gradient presets, 8 color swatches, "Upload image…"
≤ 5 MB → IndexedDB, "Remove image"). All writes via `settings.update`
(`expectedRev`, same conflict handling as options).

Widgets (each a card in `src/ui/widgets/`, reused by the side panel):

- **Search**: the same `search()` index as the popup (tabs, workspace tabs,
  saved links, quick links, closed, workspaces) with results dropdown;
  Enter on no hit → `chrome.search.query({ text, disposition: "CURRENT_TAB" })`
  (web search with the browser's default engine; `search` permission exists);
  `/` focuses; shortcut hints.
- **Quick links**: grid of favicon + title tiles (favicon via the local
  `_favicon` endpoint); "+" adds (url, title; title fetched? no: user types,
  default = host); tile menu: edit, remove (undo via trash? quick links have no
  trash: 8 s undo toast re-adds), move left/right; drag reorder; cap
  `LIMITS.quickLinks`. Writes `quicklink.set` with `expectedRev`.
- **Workspaces**: cards (color, name, tab count, open-in-window badge);
  click = `workspace.switch` in the window the dashboard lives in (its own
  window id; a new-tab page belongs to a window) — if the dashboard's window
  already owns that workspace, focus is enough; middle-click / "Open in new
  window". "New workspace" inline form (reuse `WorkspaceForm`).
- **Todos**: scope switch "Global | <active workspace>" (per the window's
  active workspace); add (Enter), toggle, edit inline (double-click / F2),
  delete, reorder (drag or Alt+↑↓), "Clear done"; cap 500 items per list;
  writes `todo.set` with `expectedRev` (whole list; coalesce rapid edits
  250 ms). Keyboard: roving list.
- **Notes**: same scope switch; textarea (autosave 500 ms debounce via
  `note.set` with `expectedRev`, conflict → reload + notice, never lose local
  text: keep the draft and show "Changed elsewhere · Reload / Keep mine");
  "Preview" toggle renders light markdown: `#`/`##` headings, `**bold**`,
  `*italic*`, `` `code` ``, `-`/`1.` lists, `[text](http(s) url)` links
  (open in new tab, `rel="noopener"`), paragraphs. No HTML passthrough, no
  images, no remote anything. Renderer in `src/core/notes/markdown.ts`
  (pure, returns a tree; UI renders it with Preact, never `innerHTML`).
- **Pomodoro**: phase, mm:ss remaining (1 s tick from `endsAt`, no worker
  calls), round N / roundsBeforeLong, Start / Stop / Skip →
  `pomodoro.start|stop|skip`; reads `pomodoro` key. Document title shows the
  remaining time while running on the dashboard ("24:59 · Tabitat").
- **Clock**: locale time (12/24 h from locale), date, greeting
  (morning/afternoon/evening/night by local hour).

Side panel: adds collapsible **Todos**, **Notes**, **Pomodoro** sections
below Recently closed (collapsed state remembered in `localStorage` per
surface; that is per-viewer UI state, allowed). The same widget components;
compact variant.

Performance: dashboard first paint < 50 ms target (§9): render from storage
synchronously after `initStore()` like the popup (≤ 150 ms race), no web
fonts, theme.css only, wallpaper image loaded after first paint
(`loading="lazy"` background swap), widgets code-split per card
(`lazy()` + `Suspense` with a fixed-height skeleton so no layout shift).
`performance.mark("tabitat:painted")` as in the popup.

Empty states for every widget (one line + the primary action).

## 5. Perf CI gate

- `scripts/check-budgets.mjs` (run by `npm run budgets` after both builds; CI
  step): gzip sizes from `.output/chrome-mv3`: popup JS ≤ 40 KB, side panel
  JS ≤ 50 KB, dashboard JS ≤ 60 KB, options JS ≤ 60 KB, recovery ≤ 40 KB,
  background ≤ 60 KB, total JS ≤ 200 KB. Prints a table; exits 1 over budget.
  JS "for a surface" = the chunks its HTML references.
- e2e: dashboard test asserts `tabitat:painted` < 300 ms (CI headroom; the
  50 ms target is checked locally and recorded in PROGRESS).
- CI workflow: add `npm run budgets` after the builds and `npx playwright
  test --project=e2e` is NOT added (needs installed Chrome; stays local).

## 6. Deferred Phase 3 items landing here

- Options: lazy-load sections (`lazy()`), `restoreLimit` field step removed
  (any integer 10–500).
- Sessions page: per-generation **Export HTML** (§2).
- Search: no per-workspace change tracking (collections are capped; measured
  fine) — closed, not carried further.

## 7. Out of scope

Onboarding, store assets, COMPATIBILITY.md, release workflow changes beyond
the budgets step, grid-pattern lists / axe (Phase 5); wallpaper image sync
(never); notes rich editor; todo due dates / reminders.

## 8. Acceptance

- `npm run check`, both builds, `npm run budgets`, `npx playwright test
  --project=e2e` green, plus new e2e: (i) dashboard renders widgets from seeded
  storage, painted mark < 300 ms; (j) adding a todo and a quick link persists
  through the worker (`todos:global`, `quicklinks` with bumped rev); (k)
  pomodoro start shows a countdown and `pomodoro` key is set; (l) HTML export
  from the recovery page contains every workspace and link and strips queries
  when asked; (m) newtab flavor manifest has `chrome_url_overrides.newtab =
  dashboard.html` (build check, not browser).
- Unit: markdown renderer (every construct + escaping + no HTML passthrough),
  `buildHtmlExport` (escaping, strip query, skip unsafe URLs, generation
  format), reminder alarm logic (due / snoozed / off / after export),
  budgets script against a fixture directory.
- Reviewed by Codex + Gemini; triage in `docs/reviews/phase4-triage.md`; tag `phase-4`.
