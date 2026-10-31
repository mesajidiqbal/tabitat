# Chrome Web Store listing

Everything the Web Store developer dashboard asks for, ready to paste. Policy answers follow
`docs/ARCHITECTURE.md` §4 (manifest) and §10 (privacy and security). Submission itself is a
manual step taken by the maintainer (docs/PHASE5.md §8); nothing here uploads anything.

Screenshots and promo tiles are generated, not hand-made: `npm run build && npm run assets`
rewrites `store/screenshots/*.png`, `store/promo-440x280.png` and `store/promo-1400x560.png`
from the demo dataset in `tests/assets/demo-data.json` (no network; see
`scripts/store-assets.ts`). Re-run it after any visible UI change.

## Store listing

| Field | Value |
| --- | --- |
| Name | Tabitat (the New Tab listing: Tabitat New Tab) |
| Category | Productivity |
| Language | English (en) |
| Homepage URL | the `REPO_URL` in `src/ui/options/about.ts` (also the manifest `homepage_url`) |
| Support URL | the repository's issues page |

**Summary** (132 characters max; this one is 117):

> Workspaces for your tabs: save, switch and search sets of tabs, with todos and notes. Local-only, no account, no network.

**Description:**

> Tabitat keeps your tabs organized in workspaces: named, colored sets of tabs you can switch
> between. Switching saves the tabs you leave and reopens the other workspace's tabs as
> lightweight placeholders that load when you visit them.
>
> - Workspaces with auto-save, saved links per workspace, and a trash with undo.
> - Search across open tabs, every workspace, saved links, quick links and recently closed tabs.
> - A side panel and a dashboard page with quick links, todos, notes and a pomodoro timer.
> - Optional tab suspension, duplicate tab cleanup and a session safety net with recovery.
> - Keyboard shortcuts, light and dark themes, JSON and HTML backups you download yourself.
>
> Private by design: no account, no server, no analytics. Tabitat makes no network requests
> (the browser enforces this for the extension), and optional settings sync carries settings
> only, never tabs, notes or todos.
>
> Good to know: a switch closes tabs, so in-page state such as scroll position or an unsent form
> is not kept. Pinned tabs stay with their window.
>
> Tabitat New Tab is the same extension with the dashboard as your new tab page. Install only
> one of the two.

**Graphic assets:**

| Asset | File | Size |
| --- | --- | --- |
| Store icon | `public/icon/128.png` | 128×128 |
| Small promo tile | `store/promo-440x280.png` | 440×280 |
| Marquee promo tile | `store/promo-1400x560.png` | 1400×560 |
| Screenshots (light and dark) | `store/screenshots/dashboard-*.png`, `options-*.png` | 1280×800 |
| Popup and side panel close-ups | `store/screenshots/popup-*.png` (720×1080), `sidepanel-*.png` (800×1600) | 2× captures |

The Web Store accepts screenshots of 1280×800 or 640×400 only. Upload the dashboard and options
captures as they are; the popup and side panel close-ups are 2× captures for the README or for
composing a 1280×800 image, and are not accepted unmodified.

## Single purpose

> Tabitat organizes the browser's tabs into workspaces that can be saved, switched and searched,
> with a side panel and dashboard for working with those workspaces. Todos, notes and the
> pomodoro timer are focus tools shown in those same surfaces (todos and notes per workspace or
> global; one pomodoro timer).

## Permission justifications

| Permission | Justification |
| --- | --- |
| `tabs` | Reads tab URLs and titles to save workspaces, list and search tabs, and restore them on a switch. The data never leaves the device. |
| `tabGroups` | Saves and restores tab groups (title, color, collapsed) as part of a workspace. |
| `storage` | Keeps workspaces, todos, notes, quick links and settings in `chrome.storage.local`; optional settings sync uses `chrome.storage.sync` (settings only). |
| `unlimitedStorage` | Large workspaces and the session history can exceed the default local storage quota; losing saved tabs to a quota error is not acceptable. |
| `sidePanel` | Provides the Tabitat side panel. |
| `alarms` | Runs periodic work without a persistent background page: session snapshots, auto-suspension checks, the trash expiry, the backup reminder and the pomodoro timer. |
| `favicon` | Shows site icons from the browser's local favicon cache (no network request). |
| `notifications` | Announces the end of a pomodoro phase. |
| `search` | The dashboard search box runs a web search with the user's default search engine, only when the user submits it. |
| `bookmarks` (optional) | Requested only when the user imports bookmarks as quick links or workspaces; never requested at install. |

Host permissions: none. Content scripts: none. Remote code: none; the content security policy
blocks every network connection from extension pages (`connect-src 'none'`). Incognito: not
allowed.

## Privacy practices (developer dashboard answers)

- **Single purpose**: as above.
- **Remote code**: No, the extension does not use remote code.
- **Data usage, data types handled**: disclose **Web history**. Tabitat handles the URLs and
  titles of open and saved tabs; they are stored only on the device and never transmitted to the
  developer or any third party. The Web Store form asks about data the extension handles, not only
  data it transmits, and the final declaration is the customer's. Do not disclose "User activity"
  or "Website content": there are no content scripts (no page content is read) and nothing tracks
  clicks, keystrokes or scrolling. The todos and notes the user types are stored locally and fit
  none of the listed categories as worded; the customer decides how to answer for them. Optional
  settings sync stores settings (suspension rules, widget layout; not the theme or an image
  wallpaper) in the user's own browser sync storage, not on any developer server.
- **Certifications** (keep all three): I do not sell or transfer user data to third parties; I do not use or
  transfer user data for purposes unrelated to the single purpose; I do not use or transfer user
  data to determine creditworthiness or for lending.
- **Privacy policy URL**: the published `PRIVACY.md` (repository link).

These answers describe the code as built; a person should confirm them against the final build
and Google's current questionnaire wording before submitting.

## Uploading (manual)

Build and zip both flavors (the release workflow does this on a `v*` tag), then upload with
[`chrome-webstore-upload-cli`](https://github.com/fregante/chrome-webstore-upload-cli), using
OAuth credentials kept outside the repository:

```sh
export EXTENSION_ID=... CLIENT_ID=... CLIENT_SECRET=... REFRESH_TOKEN=...
npx chrome-webstore-upload-cli upload --source tabitat-1.0.0.zip --extension-id "$EXTENSION_ID"
# after reviewing the draft in the dashboard:
npx chrome-webstore-upload-cli publish --extension-id "$EXTENSION_ID"
```

The New Tab flavor is a separate listing with its own extension id: repeat with
`tabitat-newtab-1.0.0.zip`.
