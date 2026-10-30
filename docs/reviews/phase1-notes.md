# Phase 1 — implementation notes for reviewers

Scope delivered: `src/core` (pure domain, 236 tests), `src/platform`
(chrome adapters + in-memory fake with failure injection), `src/messaging`
(typed RPC, valibot payload schemas), `src/background` (lanes, command
router, repository with quarantine, init barrier, reconciler, tab tracker,
durable switch engine, session guard, backup, suspender, pomodoro, badge,
commands), a developer popup, Playwright e2e on installed Chrome, and the
spike results in `docs/SPIKE.md`. 353 unit tests; coverage core 99 %,
background+messaging 96 % lines.

Known gaps the implementer reported (please weigh these too):
1. `snapshotWindow` (core) copies `favIconUrl` unfiltered; `data:` favicons
   fail the schema, so the background strips them before saving. Being
   fixed in core now.
2. Switching to an empty workspace and away again saves its `about:blank`
   tab. Being fixed in core (snapshot skips blank/newtab-only tabs).
3. Auto-save changes from the last 750 ms before a window closes are lost
   (flush on `windows.onRemoved` is too late to query tabs). Mitigations:
   5-min session generations, recently-closed. Is a `storage.session`
   last-known-tabs map worth it?
4. Resume after a worker death mid-chunk adopts placeholders by `w`/`s`
   hints; directly created tabs (`chrome://`, the blank tab) cannot be
   matched and could be duplicated once.
5. A discarded-tab id patch to a stalled op record is not laned (small
   race with alarm-driven resume).
6. Each switch reads the whole store up to 3 times.
7. `backup.import` with `replace` drops existing workspaces without
   trashing them.
8. Our own extension pages opened as tabs are treated as retained (never
   saved).
9. Not verified in a real browser: keyboard-shortcut and side-panel
   gesture paths, a real worker kill mid-switch, Edge/Brave scheme handling.
