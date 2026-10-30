# Tabitat

Workspaces for your tabs, as a Chrome extension (MV3). Local-only: no network access, no accounts.

**Status:** pre-alpha, phase 0 (repository skeleton, no features yet).

## Planned features

- Workspaces that group and switch sets of tabs per window
- Fast fuzzy search across tabs and workspaces
- Tab suspension, session recovery, side panel and dashboard
- Pomodoro timer, quick links (optional bookmarks import)

## Development

Requires Node 24 (`fnm use` reads `.node-version`) and npm.

```sh
npm install
npm run dev          # launches Chrome with HMR
npm run check        # lint + typecheck + unit tests
```

Scripts: `dev`, `dev:newtab`, `build`, `build:newtab`, `zip`, `zip:newtab`, `lint`, `format`,
`typecheck`, `test`, `test:watch`, `e2e`, `check`.

## Build flavors

- Default: `npm run build` -> `.output/chrome-mv3` ("Tabitat", no new-tab override).
- New tab: `npm run build:newtab` -> `.output-newtab/chrome-mv3` ("Tabitat New Tab", overrides the
  new tab page with the dashboard). Only one flavor should be installed at a time.

The `:newtab` scripts set `TABITAT_FLAVOR=newtab` inline, which works on macOS/Linux shells.
On Windows, set the variable first (PowerShell: `$env:TABITAT_FLAVOR="newtab"; npm run build`) or use WSL.

## Privacy

Tabitat never touches the network. Production builds ship a CSP with `connect-src 'none'`, so this is
enforced by the browser, and incognito windows are never tracked.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the design.
