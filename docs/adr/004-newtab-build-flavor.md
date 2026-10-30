# ADR-004: New-tab override ships as a separate build flavor

Status: accepted (2026-10-30). Codex recommended flavors; Gemini a single
build with a "minimal" page. Chosen: flavors.

Context: `chrome_url_overrides.newtab` cannot be toggled at runtime and
Chrome prompts users about NTP changes; many users refuse NTP takeovers.

Decision: one codebase, two builds from an env flag (`TABITAT_FLAVOR=
default|newtab`). The default listing has no override; the dashboard is a
normal extension page reachable from popup/side panel and bookmarkable
(`chrome-extension://<id>/dashboard.html`). The "Tabitat New Tab" listing
adds the override pointing to the same dashboard. Both share storage
format; only one may be installed at a time (onboarding warns).

Consequences: two store listings to maintain; CI builds both zips.
