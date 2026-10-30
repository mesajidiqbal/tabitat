# ADR-002: Lazy restore uses extension placeholder pages, not create+discard

Status: accepted (2026-10-30). Both reviewers flagged create+discard.

Context: switching workspaces must open N tabs without loading N pages.
`tabs.create` starts navigation immediately; `tabs.discard` can reject
while a tab is initializing and discarded tabs reload on activation.

Decision: restored tabs are created as
`suspended.html#u=<url>&t=<title>&w=<wsId>&s=<savedTabId>`; the page shows
title/favicon and navigates to `u` on activation (visibility change or
click). Only `http(s)`/`file`/`ftp` are wrapped; browser-internal schemes
are created directly; other extensions' pages, devtools, javascript:,
data: are skipped and reported. Workspace snapshots always store the
unwrapped URL. `tabs.discard` is reserved for suspending already-loaded
tabs. The placeholder script is external (extension CSP). The `w=` hint
also drives startup reconciliation.

Consequences: a switched-in workspace shows Tabitat placeholder tabs until
focused (same pattern as Workona/The Great Suspender); browser restart
preserves placeholders with their target URL intact.
