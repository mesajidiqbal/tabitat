**1. Verdict**

Phase 1 is substantially improved, but **not yet trustworthy enough for an unconditional Phase 2 foundation sign-off**.  
Closing and import recovery still lose acknowledged data; the new resume deduplication also closes user-created tabs.  
UI scaffolding can proceed, but resolve the short correctness list below before integrating destructive workspace controls.

I reviewed the triage, fix diff, requested source files, and regression tests. The background suite could not start because WXT could not allocate a localhost port. Isolated, in-memory reproductions using the current FakeBrowser/services confirmed the failures identified below; these were not real-Chrome tests.

**2. Original findings 1–10**

Numbering follows the original numbered findings and the triage’s first ten rows.

1. **Partially fixed — Revalidate outgoing tabs before closing.**  
   [workspace-engine.ts:657](/Users/sajid/Developer/personal/tabitat/src/background/workspace-engine.ts:657) now retrieves each tab; `saveBeforeClose` checks window/pin state and persists changed content. The stalled-navigation, pin, and move tests cover those improvements. However, removal follows additional asynchronous storage operations at lines 659–662. I injected navigation during the `switchClosed` write: the tab closed, while the outgoing workspace retained only its old URL. The check-to-remove race is narrower, but remains **high severity**.

2. **Fixed for the reported scenario — Window-close debounce loss.**  
   Event handlers update the last-known map at [tab-tracker.ts:125](/Users/sajid/Developer/personal/tabitat/src/background/tab-tracker.ts:125), mirror it to session storage at line 429, retain it during window-closing tab events at line 477, and snapshot it at line 518. Tests now cover navigation/new tabs before debounce, closure across worker restart, and previously untracked windows. This directly addresses the original omission; it does not establish arbitrary event/write scheduling safety.

3. **Fixed — Pending navigation destinations.**  
   [tab-url.ts:7](/Users/sajid/Developer/personal/tabitat/src/platform/tab-url.ts:7) prefers a pending destination while loading, including navigation from an existing page. [snapshot.ts:162](/Users/sajid/Developer/personal/tabitat/src/core/ops/snapshot.ts:162) captures before classifying blank content, and [switch-planner.ts:147](/Users/sajid/Developer/personal/tabitat/src/core/ops/switch-planner.ts:147) uses the same capture policy. The tracker also marks pending navigation dirty. The new blank-to-pending regression tests exercise the original loss case.

4. **Fixed — Live autosave overwrites replace-imported workspaces.**  
   [backup.ts:147](/Users/sajid/Developer/personal/tabitat/src/background/backup.ts:147) detaches affected windows, including surviving workspace IDs, before staging; line 171 adopts live contents separately. The regression at [backup.test.ts:137](/Users/sajid/Developer/personal/tabitat/src/background/backup.test.ts:137) verifies that subsequent navigation does not overwrite imported tabs.

5. **Partially fixed — Incomplete import replays over later edits.**  
   Startup recovery is now fatal when staging cannot be resolved, and guarded records receive revision checks. But a **runtime** import failure does not invalidate the already-successful readiness barrier: [backup.ts:203](/Users/sajid/Developer/personal/tabitat/src/background/backup.ts:203), [services.ts:71](/Users/sajid/Developer/personal/tabitat/src/background/services.ts:71). I failed staging removal three times, then successfully changed settings. Restart replay replaced that acknowledged edit. Settings and quicklinks are excluded from the revision guard at [backup.ts:57](/Users/sajid/Developer/personal/tabitat/src/background/backup.ts:57). This remains **high severity**.

6. **Partially fixed — Saved-ID integrity.**  
   Duplicate saved-tab/incoming IDs are rejected, salvage reassigns duplicates, and restoration uses own-property access: [schemas.ts:146](/Users/sajid/Developer/personal/tabitat/src/core/model/schemas.ts:146), [salvage.ts:77](/Users/sajid/Developer/personal/tabitat/src/background/salvage.ts:77), [workspace-engine.ts:574](/Users/sajid/Developer/personal/tabitat/src/background/workspace-engine.ts:574). The `constructor`/`toString` regression covers prototype-sensitive restoration. The destructive original cases are addressed, but `activeSavedTabId` remains an unconstrained optional string at schema lines 151 and 193 rather than a validated reference.

7. **Partially fixed — Partial restore becomes destructive autosave.**  
   [reconciler.ts:102](/Users/sajid/Developer/personal/tabitat/src/background/reconciler.ts:102) creates a storage generation before similarity assignment and saves `ws:prev` before granting ownership. The six-of-ten test explicitly verifies preservation. However, a later heuristic assignment overwrites that previous version at line 126, while generations rotate. The recovery page remains a stub at [App.tsx:1](/Users/sajid/Developer/personal/tabitat/src/entrypoints/recovery/App.tsx:1). Immediate preservation is fixed; durable, usable recovery remains incomplete.

8. **Fixed — Transition failures strand journal operations.**  
   Transition persistence is inside the stage catch at [workspace-engine.ts:470](/Users/sajid/Developer/personal/tabitat/src/background/workspace-engine.ts:470), and `resumePending` discovers durable operations unconditionally at line 349. The regression deliberately clears the volatile flag before firing the alarm. Durable dirty-marker discovery at [tab-tracker.ts:284](/Users/sajid/Developer/personal/tabitat/src/background/tab-tracker.ts:284) also addresses the related lifecycle concern.

9. **Partially fixed — Replace-import is irreversible.**  
   [backup.ts:131](/Users/sajid/Developer/personal/tabitat/src/background/backup.ts:131) archives closed and overwritten workspace metadata/tabs before replacement. But archives omit notes/todos, which [core/backup/index.ts:382](/Users/sajid/Developer/personal/tabitat/src/core/backup/index.ts:382) can delete. Session generations contain tabs, not those records. I replaced a backup omitting an existing note and confirmed its content disappeared from all local-storage values. The original request to preserve the full replaced dataset remains unmet.

10. **Fixed — Replacement patches resurrect obsolete journal state.**  
    Running operations are patched in memory; stalled operations acquire the window lane and reread identity at [workspace-engine.ts:394](/Users/sajid/Developer/personal/tabitat/src/background/workspace-engine.ts:394). `writeOp` checks the stored operation ID at line 423. The new tests cover stalled replacement and a late replacement after commit.

**3. New bugs introduced by the fix pass**

- **High — Resume deduplication closes legitimate user tabs.**  
  [workspace-engine.ts:743](/Users/sajid/Developer/personal/tabitat/src/background/workspace-engine.ts:743) treats URL equality with a recorded tab as sufficient proof that an unrecorded tab is a lost-create duplicate. Scenario: switching to `chrome://settings/` stalls; the user opens another settings tab; resume closes the user’s tab. I reproduced this. The same logic includes navigated placeholders, not just directly created tabs. Closures are marked switch-generated, suppressing recently-closed recovery. **Fix:** require durable creation provenance; retain ambiguous duplicates.

- **Medium — Legacy staging silently skips intended replacements.**  
  [backup.ts:78](/Users/sajid/Developer/personal/tabitat/src/background/backup.ts:78) defaults missing `baseRevs` to `{}`; line 243 then treats every existing nonnegative revision as newer than `-1`. An interrupted pre-fix import therefore skips its existing workspace/note replacements, removes staging, and reports successful replay. I reproduced an old-format staged tab replacement retaining the original URL. **Fix:** explicitly migrate legacy staging or preserve it for recovery with an explicit unsupported/conflict result.

- **Medium — Failed import falsely promises that nothing changed.**  
  [backup.ts:169](/Users/sajid/Developer/personal/tabitat/src/background/backup.ts:169) reports “nothing was replaced,” although application writes occur at line 266 before removals, reconciliation, and staging cleanup. Two later failures can leave imported records applied while returning that message. **Fix:** track transaction progress and report partial application accurately, or implement actual rollback. Add failure tests after the successful write, not only before it.

**4. Remaining must-fix before Phase 2 integration**

- **Make closure preservation cover changes during the final awaits.** Add a delayed-write/navigation regression and preserve the latest event-known content through switch-generated removal. Another earlier `tabs.get` alone cannot make removal atomic.
- **Remove URL-only automatic deduplication.** Duplicate tabs are preferable to deleting a user-owned tab without provenance.
- **Complete the import transaction contract.** Block conflicting mutations while staging survives runtime failure; handle legacy staging explicitly; archive notes/todos and other overwritten records; report partial application honestly.
- **Establish recovery retention and API semantics.** Preserve unresolved previous versions until explicit recovery/dismissal, and define restore/export access before UI depends on them. Include an actual Chrome mid-switch worker-kill test as an integration gate.

**5. Deferrable items**

Recovery-screen presentation and shortcut/gesture checks can be Phase 2 deliverables. Whole-store-read optimization, cross-browser verification, optional export query stripping, and import warnings for `file:` URLs can remain later work.

Active-ID referential validation is useful hardening but is not currently a demonstrated tab-loss blocker. The per-item salvage and combined salvage/quarantine write are meaningful improvements; retain those regressions while adding the missing delayed-operation and post-write-failure cases.
