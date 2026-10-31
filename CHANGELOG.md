# Changelog

All notable changes to Tabitat are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.0.0] - 2026-10-31

First release. Two builds: "Tabitat" and "Tabitat New Tab" (adds the new tab override; install
only one).

### Added

Workspaces and tabs (popup and side panel)
- Named, colored, ordered workspaces. A workspace is open in at most one window; each window has at
  most one active workspace. Switching saves the outgoing tabs, opens the incoming tabs as
  lightweight placeholders that load when activated, and closes the old ones, as a journaled,
  resumable operation that survives a service worker restart.
- Auto-save of tab changes into the active workspace; windows without a workspace are kept in an
  "Unsorted" workspace. Pinned tabs stay with the window.
- Create a workspace from the current window or empty; rename, recolor, reorder, open in a new
  window, delete with undo.
- Tab list with tab groups; park a tab as a saved link (button, key, or drag onto Saved links);
  close with undo.
- Saved links per workspace and a recently closed list (last 50).
- Universal fuzzy search over open tabs, workspace tabs, saved links, quick links, recently closed
  tabs and workspaces.
- Tab suspension: manual per tab and "Suspend others"; optional automatic suspension (off by
  default) after a chosen idle time, skipping pinned, audible and excluded sites.
- Duplicate tab detection with a one-click close and undo; close duplicates across all windows
  from the side panel.
- Toolbar badge with the active workspace.
- Keyboard shortcuts: search, next and previous workspace (assigned by default), suspend other
  tabs and open the side panel (unassigned). Page-level keys: `/` focus search, `n` new workspace,
  `1` to `9` switch workspace, `s` side panel, Esc. Row keys: Enter or Space, F2 rename, Delete,
  `p` park, `z` suspend, Left and Right between cells, Shift+F10 or ContextMenu for the menu.
- Side panel with collapsible Todos, Notes and Pomodoro sections.

Dashboard (and new tab page in the New Tab flavor)
- Clock and greeting, universal search with a web search fallback through the browser's default
  search engine, quick links grid, workspace cards, todos and notes (global or per workspace;
  notes render a small markdown subset with no images), pomodoro timer in the service worker with
  notifications.
- Customize panel: widget toggles and order, theme, wallpaper (gradients, colors, or an uploaded
  image of up to 5 MB stored locally in IndexedDB).

Options
- General (theme, tabs restored per switch), Suspension, Sessions, Pomodoro, Shortcuts, Data,
  About.
- Opt-in settings sync through `storage.sync` (settings only, last write wins).
- Bookmarks import into quick links or workspaces, behind the optional `bookmarks` permission.
- Backup reminder (default 30 days) with snooze and turn-off.

Recovery and safety
- Session snapshots of all windows on a timer and before each switch (default 10 kept) and a
  recovery page to restore one into a new window.
- Recovery of interrupted switches, a hint when a window of the last session was not restored after
  a restart, quarantine for records that fail validation.
- Trash for deleted workspaces and links, 30-day retention, restore and empty.
- JSON backup and import (validated and staged; replace mode keeps the previous workspaces in the
  trash; merge mode), and a bookmarks-format HTML export (all data or one snapshot, optional
  query-string stripping).

Onboarding, accessibility, i18n, release
- Welcome tour on first install (workspaces and their limitation, where things live, shortcuts,
  privacy), reopenable from Options, About.
- Grid pattern for the workspace, tab, saved link and recently closed lists; labels and live
  regions for icon-only controls, toasts, progress and errors; visible focus rings; automated axe
  checks in the end-to-end suite.
- All user-facing strings (including worker notifications), the manifest name and description and
  the command descriptions come from `_locales/en`; `npm run i18n` checks keys and placeholders.
- Performance budgets enforced in CI (gzip size per surface and in total).
- Store listing text and screenshots, `PRIVACY.md`, `SECURITY.md`, `COMPATIBILITY.md` and a tag-driven
  release workflow that attaches both zips to the GitHub release.

### Known limitations

- Closing a tab loses in-page state (scroll position, unsaved forms, history stack). Tabitat
  restores each tab's URL, title, pinned state, group and order, not live state. Pinned tabs are
  never closed by a switch.
- Automatic suspension cannot see unsaved form input (there are no content scripts), which is why
  it is off by default.
- Importing bookmarks: folders with the same name under the same parent merge into one workspace.
- A todo or quick link edit that failed to save and is shown with a Retry row is lost if you close
  the page before retrying (note drafts are kept).
- Packaged-install alarm clamping (30 s) is not measured; Tabitat never schedules below 30 s.
- Tested on Chrome 156 (end-to-end suite) and spiked on Chrome 156 and Brave 156. Edge, Vivaldi,
  Opera and Arc are untested. The real bookmarks permission grant, drag and drop, two-window new tab
  switching and delayed pomodoro alarms have manual checks only (`docs/MANUAL-QA.md`). See
  [COMPATIBILITY.md](COMPATIBILITY.md).
- No translations other than English yet.

[Unreleased]: <repo-url>/compare/v1.0.0...HEAD
[1.0.0]: <repo-url>/releases/tag/v1.0.0
