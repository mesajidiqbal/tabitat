# Privacy policy

Last updated: 2026-10-31

Tabitat is a browser extension that keeps your workspaces, tabs, notes and todos on your own
device. It has no accounts and no server of its own, and it does not collect, transmit or sell
data. This page says what is stored, where, what can leave the device, why each permission is
requested, and how to delete everything. The same text applies to both builds ("Tabitat" and
"Tabitat New Tab").

## What Tabitat stores

| Data | Notes |
|---|---|
| Workspaces | Names, colors, order |
| Tabs of each workspace | URL, title, pinned state, position, tab group, favicon address |
| Saved links | URL, title, per workspace |
| Quick links | URL, title |
| Todos and notes | Text you type, global or per workspace |
| Settings | Theme, widgets, suspension rules and excluded sites, snapshot, pomodoro and reminder options |
| Session snapshots | The last generations of all windows (default 10, every 5 minutes by default; both configurable) |
| Recently closed | The last 50 closed tabs |
| Trash | Deleted workspaces and saved links, kept 30 days, then purged |
| Pomodoro state, backup reminder state, sync status | Timer phase and end time; when the reminder is due or snoozed |
| Operation records | A short-lived record while a workspace switch or import is running, so it can resume after a crash |
| Quarantined records | Stored data that failed validation, kept so you can download or delete it on the recovery page |

Where it lives:
- `chrome.storage.local` holds all of the above. The `unlimitedStorage` permission removes the
  default size cap so large sets of tabs and snapshots fit.
- IndexedDB (database `tabitat`) holds the dashboard wallpaper image if you upload one. It is never
  synced and never included in a backup.
- `chrome.storage.session` holds caches that can be rebuilt. The browser's per-page storage
  (`localStorage` for collapsed side panel sections, `sessionStorage` for unsaved note drafts)
  holds interface state.
- Nothing is stored outside your browser profile.

## What leaves the device

Nothing is sent automatically. Tabitat makes no network requests of its own, has no analytics,
telemetry, crash reporting, advertising or remote code, and loads no web fonts or images from the
internet. Production builds enforce this: the content security policy for extension pages is

```
script-src 'self'; object-src 'none'; connect-src 'none'; img-src 'self' data: chrome-extension:; style-src 'self'
```

so the browser blocks network requests from Tabitat's pages and its service worker. Things that
involve the network only because you ask for them:

- **Dashboard web search.** When you press Enter in the dashboard search box and nothing matches,
  the text you typed is sent to your browser's default search engine through `chrome.search`, as if
  you typed it in the address bar. Tabitat does not see or keep the result.
- **Opening tabs.** Opening a saved tab or link loads that page, as any browser does. Restored
  tabs are placeholders and do not load their page until you activate them.
- **Settings sync (off by default).** If you turn it on in Options, your settings (not tabs, notes,
  todos, links or the wallpaper image) are written to `chrome.storage.sync`, which your browser
  syncs through its own account service under that service's privacy policy. Tabitat itself makes
  no request. Turning sync off leaves the copy already in sync storage; Tabitat does not delete it.
- **Downloads you start.** Backup JSON and bookmarks-format HTML exports are files saved to your
  computer by the browser. They contain full URLs and titles (and, for JSON, notes and todos), so
  treat them as private. The HTML export has a "Strip query strings" option that removes query and
  fragment parts of URLs.

## Permissions and why

| Permission | Why Tabitat needs it |
|---|---|
| `tabs` | Read the URL, title, pinned state and position of your tabs to save and restore workspaces, search, find duplicates and suspend tabs. This is the only permission that exposes browsing data. |
| `tabGroups` | Save and recreate tab groups (title, color, collapsed state). |
| `storage` | Keep all data in `chrome.storage.local`, and settings in `chrome.storage.sync` only if you turn sync on. |
| `unlimitedStorage` | Lift the default storage cap for large workspaces, snapshots and backups. |
| `sidePanel` | Show the Tabitat side panel. |
| `alarms` | Timers that survive the service worker sleeping: session snapshots, flushing pending auto-saves, suspension checks, trash purge, backup reminder, pomodoro phases. |
| `sessions` | Declared in the manifest. No current feature calls the `chrome.sessions` API; Tabitat's own session snapshots live in its storage and do not use it. |
| `favicon` | Show site icons through the extension's local `_favicon` endpoint, served from the browser's own cache. |
| `notifications` | Tell you when a pomodoro phase ends. |
| `search` | Run the dashboard web search with your default search engine. |
| `bookmarks` (optional) | Requested only when you click "Choose bookmarks..." in Options to import bookmarks as quick links or workspaces. You can remove it afterwards from the same page. |

Tabitat requests no host permissions and has no content scripts, so it cannot read or change the
content of any web page. `incognito` is set to `not_allowed`: Tabitat does not run in incognito
windows and never records them.

## Deleting your data

- **Everything:** remove the extension from `chrome://extensions` (or your browser's equivalent).
  The browser deletes the extension's local storage, IndexedDB and page storage with it. A copy of
  your settings in sync storage, if you used sync, is not removed by Tabitat.
- **Trash:** Options, Data, "Empty trash", or the recovery page, "Empty trash" or "Delete now" per
  item. Items are purged automatically after 30 days.
- **A workspace or link:** delete it (it goes to the trash), then empty the trash.
- **Notes, todos, quick links:** delete them in the dashboard or side panel.
- **Wallpaper image:** Customize, "Remove image" on the dashboard.
- **Quarantined records:** the recovery page, Delete.
- **Settings:** Options, Data, "Reset all settings" restores defaults. It does not delete
  workspaces or other saved data.
- **Backups you exported** are ordinary files; delete them yourself.

## Contact

Questions about this policy: `<maintainer email>`. Security problems: see [SECURITY.md](SECURITY.md).
Changes to this policy are listed in [CHANGELOG.md](CHANGELOG.md) with the new "Last updated" date.
