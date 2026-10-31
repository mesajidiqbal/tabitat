# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem. Report it privately in one of two ways:

- GitHub private vulnerability reporting: `<repo-url>/security/advisories/new`
- Email: `<maintainer email>` with the subject "Tabitat security"

Include the Tabitat version and flavor (Options, About), the browser and version, what you did,
what you expected and what happened, and if you can, a minimal reproduction. Please do not include
your own browsing data; a synthetic example is enough.

What to expect: the maintainer will acknowledge the report, reproduce it, and tell you the outcome.
Credit in the changelog is available if you want it. Please give a reasonable time to fix
before you disclose publicly.

## Supported versions

Only the latest release receives security fixes. Older versions are not patched; update to the
latest release (or the latest Chrome Web Store version).

## Scope

In scope: the Tabitat extension in this repository (both flavors, the service worker, every
extension page, the build and release workflows) and its handling of stored data, imports and
backups. Examples: a way to make Tabitat make a network request, run script from stored or
imported data, restore a `javascript:`, `data:` or `vbscript:` URL, escape the notes renderer, or
read or write data of another extension or origin.

Out of scope: vulnerabilities in the browser itself or in other extensions, and issues that need
local access to your unlocked browser profile (the data is stored unencrypted in the profile, as
for any extension). There are no Tabitat servers or accounts, so there is no backend to test.

## Design notes relevant to reporters

No host permissions or content scripts; production CSP `connect-src 'none'`; `incognito` is
`not_allowed`; imports reject `javascript:`, `data:` and `vbscript:` URLs and are validated and
staged before they replace anything. See [PRIVACY.md](PRIVACY.md) and
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) section 10.
