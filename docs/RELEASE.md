# Release procedure

For maintainers. A release is a git tag; the tag triggers `.github/workflows/release.yml`, which
builds and publishes the zips. Submitting to the Chrome Web Store is a separate, manual step.

## 1. Before you tag

1. Fill in the placeholders (list at the end of this page). A release with `<repo-url>` or
   `<maintainer email>` still in it must not ship.
2. Run the manual checklist `docs/MANUAL-QA.md` (Q1 to Q15) on Chrome stable and on Brave or
   Edge; fill in its results table. Fix or consciously accept every failure.
3. Update `CHANGELOG.md`: move entries from `[Unreleased]` into a new `## [X.Y.Z] - YYYY-MM-DD`
   section (Added, Changed, Fixed, Known limitations as needed) and update the link definitions
   at the bottom. The workflow publishes exactly this section as the release notes and fails if it
   is missing or empty.
4. Bump the version. The manifest version follows `package.json`.
   ```sh
   npm version 1.0.0 --no-git-tag-version      # use the real version; skip if already set
   git add package.json package-lock.json CHANGELOG.md
   git commit -m "chore(release): 1.0.0"
   ```
5. Verify locally exactly what CI will run:
   ```sh
   npm ci
   npm run check
   npm run build && npm run build:newtab
   npm run budgets
   npm run zip && npm run zip:newtab
   npm run build && npm run e2e         # needs installed Chrome; not run in CI
   ```
6. Push `main`, wait for CI to pass.

## 2. Tag

```sh
git tag v1.0.0
git push origin main v1.0.0
```

The tag must equal `v` plus the `package.json` version, or the workflow stops at its first step.
A tag with a hyphen (for example `v1.1.0-rc.1`) publishes as a pre-release and still needs a
CHANGELOG section.

## 3. What the release workflow does

On a tag matching `v*`:

1. Checks out, sets up Node 24 with the npm cache.
2. Fails if the tag (without the leading `v`) differs from `package.json`'s version.
3. `npm ci`, then `npm run check` (lint, typecheck, unit tests, i18n).
4. `npm run build` and `npm run build:newtab`, then `npm run budgets` (both builds).
5. `npm run zip` and `npm run zip:newtab`. `wxt zip` names both `tabitat-<version>-chrome.zip`, in
   `.output/` and `.output-newtab/`; the workflow copies them to `release-assets/` as
   `tabitat-<version>.zip` (default flavor) and `tabitat-newtab-<version>.zip` (New Tab flavor).
6. Extracts the `## [<version>]` section of `CHANGELOG.md` as the release body.
7. Creates the GitHub release with `softprops/action-gh-release@v2`, attaching the two zips.

It does not upload to the Chrome Web Store and does not run the e2e suite.

## 4. Chrome Web Store (manual)

Two listings: "Tabitat" and "Tabitat New Tab" (ADR-004). Listing text, privacy answers and
screenshots are in [store/README.md](../store/README.md), including the
`chrome-webstore-upload-cli` command if you want to upload from the command line.

1. Download `tabitat-<version>.zip` and `tabitat-newtab-<version>.zip` from the GitHub release
   (do not rebuild locally; submit the exact release artifacts).
2. Create or open each listing in the Developer Dashboard and upload the matching zip.
3. Paste the listing fields from `store/README.md`; upload the screenshots and promo images from
   `store/`.
4. Set the privacy policy URL to the published `PRIVACY.md` and answer the privacy practices
   questionnaire from `store/README.md` (single purpose, permission justifications, no remote
   code, no data collected).
5. Submit for review. After approval, put the store URL in the README (`<chrome-web-store-url>`).

## 5. After the release

1. Tag the phase if this release closes one: `git tag phase-5 && git push origin phase-5`.
2. Update `docs/PROGRESS.md`: current checkpoint, test and budget numbers, deferred items, the
   phase log row.
3. Record compatibility findings from Q15 in `COMPATIBILITY.md`.
4. Start the next `[Unreleased]` section in `CHANGELOG.md`.

## 6. Customer checklist (from docs/PHASE5.md section 8)

These steps are the customer's decisions and are prepared, not executed, by the engineering work.

1. Decide the repository name and organization; set `REPO_URL`, `homepage_url`, README links and
   the PRIVACY contact; push `main` and the `phase-*` tags.
2. Run `docs/MANUAL-QA.md` Q1 to Q15 on Chrome stable and at least Brave or Edge; record results.
3. Tag `v1.0.0` (the release workflow publishes the zips).
4. Web Store: create the listing from `store/README.md`, upload `tabitat-1.0.0.zip` (and the New
   Tab listing separately, `tabitat-newtab-1.0.0.zip`), answer the privacy questionnaire, submit
   for review.

## 7. Placeholders to fill in

| Placeholder | Where it appears | Fill with |
|---|---|---|
| `<repo-url>` | `README.md`, `COMPATIBILITY.md`, `SECURITY.md`, `CHANGELOG.md` link definitions | Public repository URL, for example `https://github.com/<owner>/tabitat` |
| `<chrome-web-store-url>` | `README.md` install section | Listing URL after approval (the text says "coming soon" until then) |
| `<maintainer email>` | `PRIVACY.md`, `SECURITY.md` | Address for privacy questions and private security reports |
| `REPO_URL` constant and manifest `homepage_url` | source (set by the Phase 5 code work), About page | Same repository URL as `<repo-url>` |
| Anything in `store/README.md` | store listing text | See that file; it lists its own placeholders |

Also confirm before submitting: private vulnerability reporting is enabled on the repository (the
`SECURITY.md` link uses it), and issues are enabled (the `COMPATIBILITY.md` link uses them).

## 8. Open items found while writing the docs

- The manifest requests the `sessions` permission, but no source file calls the `chrome.sessions`
  API (Tabitat's session snapshots use its own storage). `PRIVACY.md` says so plainly. An unused
  permission can draw a Web Store review question; either
  remove it from `wxt.config.ts` (and the permissions table in `PRIVACY.md`) or document the use,
  before submitting.
