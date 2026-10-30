# Phase 1 review triage

Reviewers: Codex GPT-6 (`phase1-codex.md`), Gemini 3.8 Flash High
(`phase1-gemini.md`; its line numbers refer to the review bundle, not
source files). Both reviewed the same code at commit `d85cf2d`.

Both verdicts: design sound (journal, snapshot-before-close, retention),
but not yet trustworthy for "never lose a tab". Phase 2 UI waits for the
fixes below. Fix pass letters refer to the implementation brief.

| # | Finding | Codex | Gemini | Decision / fix |
|---|---|---|---|---|
| 1 | Closing stage uses stale tab ids without revalidating URL/pin/window | high | – | ✅ A: revalidate each outgoing tab, write changed URL before close, retain moved/pinned |
| 2 | Window close discards last ≤750 ms of changes (debounce) | high | high | ✅ C: event-updated last-known map in `storage.session`, used on `windows.onRemoved` |
| 3 | Pending navigation ignored (`pendingUrl`) | high | (fake divergence) | ✅ B |
| 4 | Replace-import overwritten by live auto-save of surviving ids | high | – | ✅ D2: detach windows of replaced workspaces |
| 5 | Unfinished import replays stale staged writes; init treats failure as nonfatal | high | – | ✅ D3: resolve before commands, revision-aware replay, `import:failed` |
| 6 | Duplicate saved ids / prototype keys (`in` checks) | high | – | ✅ E |
| 7 | Jaccard reconciliation makes partial restore an overwrite | high | – | ✅ F: pre-reconcile generation + provisional window + `ws:prev` |
| 8 | Transition write failure outside catch; volatile pending-ops flag | medium | medium | ✅ G |
| 9 | Replace-import deletes workspaces without trash | high | critical | ✅ D1: trash + generation first |
| 10 | Unlaned replacement patch to op record | medium | – | ✅ G |
| 11 | One malformed tab quarantines the whole `ws:tabs` record | – | critical | ✅ K: per-item salvage |
| 12 | Abandoned switch leaves incoming placeholders; next snapshot contaminates outgoing | – | high | ✅ L |
| 13 | `ownerOf` ignores stale window records → false `conflict` | – | high | ✅ M |
| 14 | Quarantine removes key before salvage write | – | medium | ✅ K |
| 15 | `closedBySwitch` in memory only | – | lifecycle | ✅ N |
| 16 | Init failure cached forever (bricked until reload) | yes | yes | ✅ H: degraded mode, re-attempt |
| 17 | `storage.session` epoch ≠ browser restart | yes | – | ✅ H: verify window ids via `windows.getAll` |
| 18 | Import bounds / staging key families / URL policy alignment | yes | yes | ✅ D4, D5, I, O |
| 19 | Favicon endpoint URL includes query/hash | – | low | ✅ O (origin+path only; endpoint is local anyway) |
| 20 | `file:` restorable → crafted import could navigate to local files | – | medium | ➖ Keep `file:` (users save local docs); navigation only happens on explicit activation of a tab the user restored. Revisit with an import warning in Phase 3 UI. |
| 21 | Own extension pages never saved | can wait | must fix | ✅ P (small) |
| 22 | Fake fidelity: sync listeners, lost results after worker death, pending nav, partial restore, get→null, pinned grouping throws | yes | yes | ✅ J (partial; sync-vs-async listener dispatch left as is — our handlers never rely on ordering between events) |
| 23 | Switch longer than SW 5-min limit | low | – | ❌ Not realistic: 100-tab limit ≈ 0.7 s measured |
| 24 | Full URLs with tokens persist in exports | low | – | ➖ Documented in privacy notes; export is user-initiated and local. Phase 4 adds an export option to strip query strings. |
| 25 | Duplicate directly-created tab after mid-chunk worker death | can wait | can wait | ✅ J (post-resume dedupe) — cheap enough to do now |
| 26 | Triple whole-store read per switch | can wait | can wait | ⏭ Profile in Phase 4 |
| 27 | Recovery screen is a stub | before Phase 2 UI | – | ⏭ Phase 2 deliverable (UI) |
| 28 | Real-browser verification of worker kill mid-switch, shortcuts, side panel gesture | must | must | ⏭ Phase 2: Playwright CDP `stopWorker` test for mid-switch kill; shortcut/gesture manual checklist in `docs/MANUAL-QA.md` |
