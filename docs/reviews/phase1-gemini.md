# Phase 1 Code Review: Manifest V3 Architecture & Tabitat Engine

### 1. Verdict
1. **The core state machine, pure planner, and domain boundaries are thoughtfully designed**, reflecting strong architectural rigor and high unit-test coverage.
2. **However, critical data-loss vulnerabilities exist in storage error-handling, window-close races, import handling, and MV3 service-worker lifecycle assumptions** that violate the extension's core principle: *never lose a tab*.
3. **Verdict: CONDITIONAL REJECTION.** Phase 2 UI implementation must be blocked until the P0 data-loss bugs, storage quarantine logic, and service-worker lifecycle edge cases are resolved.

---

### 2. Data-Loss and Correctness Bugs

#### Bug 2.1: Single Malformed Tab in `ws:tabs` Causes Quarantine of Entire Workspace to 0 Tabs
- **File:Line**: [`src/background/repository.ts:1680-1685`](file:///Users/sajid/Developer/personal/tabitat/src/background/repository.ts#L1680-L1685) and [`src/background/repository.ts:1574-1587`](file:///Users/sajid/Developer/personal/tabitat/src/background/repository.ts#L1574-L1587)
- **Severity**: **Critical**
- **Failing Scenario**: A user has a workspace with 50 tabs. One tab loads a page with an unparseable or disallowed favicon URL (e.g. `data:` scheme or malformed string) or a corrupted index. When `getWorkspace(id)` is called during switch or auto-save, `parseWorkspaceTabs` throws `SchemaError`. Because `getWorkspace` calls `validate` without a `salvage` callback, `validate()` moves the entire record `ws:tabs:<id>` to `corrupt:ws:tabs:<id>`, deletes `ws:tabs:<id>` from `storage.local`, and returns `null`. `getWorkspace` then substitutes `emptyTabs(meta.updatedAt)` (0 tabs). At the next switch or snapshot, the 0-tab state is committed, permanently wiping all 50 tabs from the workspace.
- **Fix**: Provide a `salvage` function in `getWorkspaceTabs` and `getWorkspace` that runs `safeParse(SavedTabSchema)` per tab element, discards or cleans invalid fields (sanitizing URLs and favicons), and returns a `WorkspaceTabs` object containing all surviving tabs instead of nuking the entire key.

```ts
// src/background/repository.ts
getWorkspaceTabs(id: WorkspaceId): Promise<WorkspaceTabs | null> {
  return this.read(Keys.wsTabs(id), parseWorkspaceTabs, (raw) => {
    if (typeof raw !== "object" || raw === null) return null;
    const r = raw as Record<string, unknown>;
    const rawTabs = Array.isArray(r.tabs) ? r.tabs : [];
    const validTabs: SavedTab[] = [];
    for (const t of rawTabs) {
      const res = v.safeParse(SavedTabSchema, t);
      if (res.success) validTabs.push(res.output);
    }
    return {
      tabs: validTabs,
      updatedAt: typeof r.updatedAt === "number" ? r.updatedAt : this.now(),
      rev: typeof r.rev === "number" ? r.rev : 0,
    };
  });
}
```

---

#### Bug 2.2: `backup.import` in `replace` Mode Purges Existing Workspaces with Zero Trash Retention
- **File:Line**: [`src/background/backup.ts:2220-2248`](file:///Users/sajid/Developer/personal/tabitat/src/background/backup.ts#L2220-L2248)
- **Severity**: **Critical**
- **Failing Scenario**: User imports a backup file using `mode: "replace"`. `planImport` marks all existing workspace keys (`ws:meta:*`, `ws:tabs:*`) for removal in `plan.remove`. Staging applies the deletion directly via `repo.remove(remove)`. If the imported backup file was outdated, partial, or selected by mistake, all existing inactive workspaces are permanently obliterated from `storage.local` with no safety generation and no entries written to `Keys.trash`.
- **Fix**: Before applying staged `replace` operations in `importBackup`, capture a forced session generation (`sessionGuard.take({ force: true })`) and move every existing workspace to `Keys.trash` with a 30-day retention timestamp.

---

#### Bug 2.3: Un-debounced Window Close Loses All Tabs Created in Named Workspaces During the Debounce Window
- **File:Line**: [`src/background/tab-tracker.ts:1106-1156`](file:///Users/sajid/Developer/personal/tabitat/src/background/tab-tracker.ts#L1106-L1156)
- **Severity**: **High**
- **Failing Scenario**: A user opens several tabs in a named workspace and closes the window (or quits Chrome). Chrome fires `tabs.onRemoved` with `isWindowClosing: true` (which `TabTracker.handleRemoved` explicitly ignores at line 1082) followed by `windows.onRemoved`. `handleWindowRemoved` immediately cancels the pending 750ms debounce timer (`clearTimeout(p.timer)`) and deletes `this.dirty` and `this.lastKnown` for that window. Lines 1118-1155 only backup tabs if `ws.meta.kind === "unsorted"`. For named workspaces, nothing is written. All tabs opened during the debounce window are permanently lost because the window can no longer be queried.
- **Fix**: In `handleWindowRemoved`, check if the window was dirty (`this.isDirty(windowId)`). If dirty and the window is already closed, reconstruct the tab list from `this.lastKnown` (or session cache) and flush it directly to `ws:tabs:<wsId>` before deleting window state.

---

#### Bug 2.4: Interrupted Switch Abandonment Cross-Contaminates and Corrupts the `from` Workspace
- **File:Line**: [`src/background/workspace-engine.ts:326-348`](file:///Users/sajid/Developer/personal/tabitat/src/background/workspace-engine.ts#L326-L348) and [`src/core/ops/switch-planner.ts:3490-3494`](file:///Users/sajid/Developer/personal/tabitat/src/core/ops/switch-planner.ts#L3490-L3494)
- **Severity**: **High**
- **Failing Scenario**: A switch from workspace `A` to `B` crashes or the worker is killed during `stageOpening` after creating 5 placeholder tabs for `B`. While the worker is dead, the user closes an outgoing tab from `A`, or the browser restarts. On revival, `canResume` checks `allExist(op.outgoingTabIds)`, finds an outgoing tab missing, and returns `"abandon"`. `abandon()` removes `op:switch:<windowId>`. However, `Keys.window(windowId).activeWorkspaceId` is still `A` (because `stageActivating` never ran), and the 5 newly created placeholders for `B` remain open in the window. `TabTracker` unlocks, runs `snapshotNow()`, and writes all tabs in the window (both `A`'s remaining tabs AND `B`'s placeholders) into `ws:tabs:A`. Workspace `A` is now permanently corrupted with tabs from `B`.
- **Fix**: When abandoning an op where tabs have already been created (`Object.keys(op.createdTabIds).length > 0`), `abandon()` must explicitly remove the created tabs from the window or reset `activeWorkspaceId` to `null` to force an isolated Unsorted workspace, rather than allowing `from` to snapshot them.

---

#### Bug 2.5: Stale Session Epochs in `ownerOf` Cause Spurious `conflict` Rejections on Window Reuse
- **File:Line**: [`src/background/workspace-engine.ts:569-575`](file:///Users/sajid/Developer/personal/tabitat/src/background/workspace-engine.ts#L569-L575)
- **Severity**: **High**
- **Failing Scenario**: Chromium allocates small integer IDs (1, 2, ...) to windows, cycling across restarts. After a browser restart, `storage.local` contains `windows:1` referencing `workspace-alpha` from the prior session epoch. The user switches window 1 to `workspace-beta`, then opens window 2 and requests `workspace-alpha`. `ownerOf("workspace-alpha")` iterates stored states and finds `windowId: 1`. It queries `getWindow(1)`, which exists in the new session. Because `ownerOf` does not verify `st.sessionEpoch === this.ctx.epoch`, it falsely concludes `workspace-alpha` is already open in window 1, throwing `RpcError("conflict")` and preventing the user from accessing their workspace.
- **Fix**: Add an epoch check in `ownerOf`:
```ts
// src/background/workspace-engine.ts
async ownerOf(id: WorkspaceId): Promise<number | null> {
  const states = await this.ctx.repo.listWindowStates();
  for (const [windowId, st] of states) {
    if (st.sessionEpoch !== this.ctx.epoch) continue;
    if (st.activeWorkspaceId !== id) continue;
    if (await this.ctx.getWindow(windowId)) return windowId;
  }
  return null;
}
```

---

#### Bug 2.6: Quarantining a Salvageable Record Deletes the Original Key Before the Salvaged Value Is Written
- **File:Line**: [`src/background/repository.ts:1577-1585`](file:///Users/sajid/Developer/personal/tabitat/src/background/repository.ts#L1577-L1585) and [`src/background/repository.ts:1611-1615`](file:///Users/sajid/Developer/personal/tabitat/src/background/repository.ts#L1611-L1615)
- **Severity**: **Medium**
- **Failing Scenario**: A salvageable record (e.g. `ws:index` or `recentlyClosed`) has one corrupt entry. `validate()` calls `quarantine()`, which copies the corrupt data to `corrupt:<key>` and executes `await this.store.remove(key)`. If the service worker is killed immediately after `remove(key)` before `store.set({ [key]: fixed })` executes, the key is permanently lost from storage.
- **Fix**: If a `salvage` function is provided, do not remove `key` inside `quarantine()`. Allow the salvaged payload to overwrite `key` atomically in `store.set()`.

---

#### Bug 2.7: In-Memory `mayHavePendingOps` Flag Suppresses Switch Recovery After Service Worker Revival
- **File:Line**: [`src/background/workspace-engine.ts:268-270`](file:///Users/sajid/Developer/personal/tabitat/src/background/workspace-engine.ts#L268-L270) and [`src/background/workspace-engine.ts:421`](file:///Users/sajid/Developer/personal/tabitat/src/background/workspace-engine.ts#L421)
- **Severity**: **Medium**
- **Failing Scenario**: An op fails mid-switch and is written to storage. The service worker is terminated by Chrome. When an alarm (e.g. `flush-dirty`) revives the worker, `WorkspaceEngine.mayHavePendingOps` defaults to `false`. When `resumePending()` is called, line 268 (`if (!this.mayHavePendingOps) return;`) immediately aborts without inspecting `repo.listOps()`. The stalled op remains stranded in storage. Furthermore, line 421 causes `onTabReplaced` to ignore discarded tabs during this state, breaking subsequent resume attempts.
- **Fix**: Remove the in-memory `mayHavePendingOps` guard or initialize it by checking `repo.listOps()` during startup.

---

### 3. Divergences Between `fake.ts` and Real Chrome

1. **Synchronous vs. Asynchronous Event Dispatch**:
   - In [`src/platform/fake.ts:3079`](file:///Users/sajid/Developer/personal/tabitat/src/platform/fake.ts#L3079), [`src/platform/fake.ts:3948`](file:///Users/sajid/Developer/personal/tabitat/src/platform/fake.ts#L3948), and [`src/platform/fake.ts:3229`](file:///Users/sajid/Developer/personal/tabitat/src/platform/fake.ts#L3229), `fake.ts` invokes listener callbacks *synchronously* inside port operations (`tabs.discard`, `storage.set`, `tabs.create`). In Chrome, all extension events cross process boundaries via IPC and are queued asynchronously on the JS event loop. Tests asserting that state is patched immediately after a call pass in `fake.ts` but race in real Chrome.
2. **Worker Kill Emulation Masks In-Flight Browser Side-Effects**:
   - In [`src/platform/fake.ts:2927-2928`](file:///Users/sajid/Developer/personal/tabitat/src/platform/fake.ts#L2927-L2928), `killWorker()` gates in-flight operations on `NEVER`, preventing them from ever completing in the fake browser. In real Chrome, terminating a service worker *does not cancel browser-side IPC calls*. In-flight `chrome.tabs.create` or `chrome.tabs.remove` calls complete in the browser process, and Chrome dispatches `onCreated`/`onRemoved` to the revived worker. `fake.ts` fails to test the recovery of orphaned tabs created by in-flight calls during SW termination.
3. **`tabs.remove` Error Behavior Divergence**:
   - In [`src/platform/fake.ts:3044-3053`](file:///Users/sajid/Developer/personal/tabitat/src/platform/fake.ts#L3044-L3053), `fake.ts` rejects batched calls containing stale IDs. However, [`src/platform/chrome.ts:2381-2390`](file:///Users/sajid/Developer/personal/tabitat/src/platform/chrome.ts#L2381-L2390) swallows `isNoTabError`. The test fake rejects where production code silently succeeds, leading tests to verify error recovery paths that production never triggers.
4. **Immediate URL Availability vs. `pendingUrl`**:
   - In [`src/platform/fake.ts:3207-3208`](file:///Users/sajid/Developer/personal/tabitat/src/platform/fake.ts#L3207-L3208), `fake.ts` immediately populates `tab.url = init.url`. In Chrome, `tab.url` is empty string (`""`) on created tabs until navigation commits, with the target held in `tab.pendingUrl`. Code checking `tab.url` immediately after creation works in tests but fails or reads blank in real Chrome.
5. **Storage Serialization and Type Fidelity**:
   - [`src/platform/fake.ts:3261`](file:///Users/sajid/Developer/personal/tabitat/src/platform/fake.ts#L3261) uses `structuredClone()`, which preserves Maps, Sets, and Dates. Real `chrome.storage.local` serializes strictly to JSON, converting Dates to ISO strings and silently dropping unsupported types. Furthermore, `fake.ts` does not enforce Chrome's 5MB `QUOTA_BYTES` storage ceiling.
6. **Pinned Tab Grouping Constraints**:
   - [`src/platform/fake.ts:3085-3090`](file:///Users/sajid/Developer/personal/tabitat/src/platform/fake.ts#L3085-L3090) permits grouping pinned tabs. Chrome's API throws an error if any tab in `chrome.tabs.group({ tabIds })` is pinned (`"Tabs cannot be both grouped and pinned"`).

---

### 4. Manifest V3 Lifecycle Issues

1. **Floating Promises in Event Listeners Break SW Lifecycle**:
   - In [`src/background/tab-tracker.ts:897-904`](file:///Users/sajid/Developer/personal/tabitat/src/background/tab-tracker.ts#L897-L904), the `guard` wrapper launches floating promises:
     ```ts
     const guard = <A extends unknown[]>(fn: (...a: A) => Promise<void>) => (...a: A) => {
       void (async () => { await this.deps.ready(); await fn(...a); })();
     };
     ```
   - Chrome event handlers (`chrome.tabs.onRemoved`, `chrome.windows.onRemoved`) return synchronously. Chrome does not know async work is in progress and may terminate the service worker mid-execution during `handleWindowRemoved`, leaving `recentlyClosed` and `trash` writes half-finished.
2. **Debounce via `setTimeout` Does Not Prevent SW Sleep**:
   - `TabTracker.markDirty` relies on `setTimeout(..., 750)`. In MV3, `setTimeout` does not keep the service worker alive. If no user events occur, Chrome kills the worker after 30 seconds idle (or sooner under pressure). The debounced flush is aborted. While the durable `dirty:<windowId>` key mitigates this, it forces the user to wait up to 60 seconds for the `flush-dirty` alarm to wake the worker and save tabs.
3. **Deadly `ReadyBarrier` Failure Mode Bricks the Extension**:
   - In [`src/background/ready.ts:1246-1255`](file:///Users/sajid/Developer/personal/tabitat/src/background/ready.ts#L1246-L1255), if `runInit` throws an error during migration or reconciliation, `this.reject(e)` rejects `defaultBarrier.promise`. This promise is never reset. Every subsequent event handler awaiting `ready()` immediately rejects. Incoming browser events keep reviving or extending the worker, trapping it in a permanently bricked zombie loop where no tabs can ever be tracked or saved until manual extension reload.
4. **Transient State Erased on Worker Termination**:
   - `WorkspaceEngine.closedBySwitch` ([`src/background/workspace-engine.ts:75`](file:///Users/sajid/Developer/personal/tabitat/src/background/workspace-engine.ts#L75)) is held in memory. When the worker restarts mid-switch, this map is cleared. Outgoing tabs that close during or after the restart are mistakenly treated as user-initiated closures, polluting `recentlyClosed`.

---

### 5. Security & Privacy Issues

1. **Information Leakage via Chrome Favicon API**:
   - In [`src/entrypoints/suspended/main.ts:4451`](file:///Users/sajid/Developer/personal/tabitat/src/entrypoints/suspended/main.ts#L4451), `icon.src` appends `encodeURIComponent(target)` to `chrome.runtime.getURL("/_favicon/")`. URLs containing sensitive tokens, passwords, or reset hashes leak to Chrome's local favicon cache database. Query parameters should be stripped before requesting favicons.
2. **`file://` Scheme Permitted in Placeholders**:
   - In [`src/core/ops/url.ts:3687`](file:///Users/sajid/Developer/personal/tabitat/src/core/ops/url.ts#L3687) and [`src/entrypoints/suspended/main.ts:4442`](file:///Users/sajid/Developer/personal/tabitat/src/entrypoints/suspended/main.ts#L4442), `file:` is treated as a restorable placeholder scheme. If a user has "Allow access to file URLs" enabled, an untrusted workspace import or malformed link can trigger automatic local file reads and navigation (`location.replace("file:///...")`).
3. **Overly Permissive Scheme Validation in `ClosedTab`**:
   - In [`src/core/model/schemas.ts:4170`](file:///Users/sajid/Developer/personal/tabitat/src/core/model/schemas.ts#L4170), `ClosedTabSchema.url` uses `SafeUrlSchema` instead of `RestorableUrlSchema`. This permits `blob:`, `filesystem:`, and foreign schemes to be saved in `recentlyClosed`. `blob:` URLs become dead pointers as soon as the generating context closes.
4. **Unbounded Storage in Backup Import**:
   - In [`src/core/model/schemas.ts:4289-4300`](file:///Users/sajid/Developer/personal/tabitat/src/core/model/schemas.ts#L4289-L4300), `BackupFileSchema` does not enforce item caps or size limits on imported tabs, workspaces, or resources, allowing a hostile or corrupted JSON file to exceed storage quotas or cause denial of service.

---

### 6. Assessment of Known-Gaps List

| Gap | Description | Verdict | Justification |
|---|---|---|---|
| **1** | `snapshotWindow` copies `favIconUrl` unfiltered; `data:` favicons fail schema | **Must Fix Before Phase 2** | A schema failure on `favIconUrl` triggers repository quarantine, deleting the entire `ws:tabs` record and destroying the workspace. |
| **2** | Switching to empty workspace and away saves `about:blank` | **Must Fix Before Phase 2** | Clutters workspaces with garbage tabs and breaks URL-similarity matching in startup window reconciliation. |
| **3** | Auto-save changes from last 750 ms before window close are lost | **Must Fix Before Phase 2** | Directly violates the prime directive *never lose a tab*. Users frequently close windows immediately after finishing work in a tab. |
| **4** | Direct schemes (`chrome://`) duplicated once on mid-chunk worker kill | **Can Wait** | Edge case affecting only internal pages during a crash. Does not cause data loss; tabs are simply duplicated once. |
| **5** | Discarded-tab ID patch to stalled op is un-laned | **Must Fix Before Phase 2** | Interacts with `mayHavePendingOps` to cause `canResume` to fail and abandon switches, corrupting workspace tabs. |
| **6** | Switch reads whole store up to 3 times | **Can Wait** | Performance optimization. Read latency is ~0.2ms (Spike S14); does not affect correctness or safety. |
| **7** | `backup.import` replace drops workspaces without trash | **Must Fix Before Phase 2** | Catastrophic data loss. Replaced workspaces must be moved to trash or backed up in a pre-import session generation. |
| **8** | Extension's own pages treated as retained / never saved | **Must Fix Before Phase 2** | Closes dashboard and notes tabs on switch and drops them from history, frustrating users. |
| **9** | Unverified paths: shortcuts, side-panel gestures, kill mid-switch | **Must Fix Before Phase 2** | Spike S10 proved sidepanel/commands fail without verified user gestures in MV3. Must verify before building UI. |

---

### 7. Top 10 Concrete Changes, Ranked

1. **Fix Catastrophic Workspace Quarantine Wipeout**:
   - In [`src/background/repository.ts:1680-1685`](file:///Users/sajid/Developer/personal/tabitat/src/background/repository.ts#L1680-L1685), pass a `salvage` function to `parseWorkspaceTabs` in `getWorkspace` and `getWorkspaceTabs` to rescue valid tabs when one tab fails schema validation, preventing 50-tab workspaces from being replaced with `emptyTabs()`.
2. **Move Existing Workspaces to Trash on Replace-Import**:
   - In [`src/background/backup.ts:2220-2232`](file:///Users/sajid/Developer/personal/tabitat/src/background/backup.ts#L2220-L2232), trigger a forced `sessionGuard.take({ force: true })` and move all existing workspaces to `Keys.trash` before executing a `replace` import.
3. **Rescue Un-flushed Tabs on Window Removal**:
   - In [`src/background/tab-tracker.ts:1106-1135`](file:///Users/sajid/Developer/personal/tabitat/src/background/tab-tracker.ts#L1106-L1135), if `this.isDirty(windowId)` or `this.pending.has(windowId)` when a window closes, reconstruct the tab snapshot from `this.lastKnown` and persist it to `ws:tabs:<wsId>` before deleting window state.
4. **Prevent Cross-Workspace Contamination on Abandoned Switch**:
   - In [`src/background/workspace-engine.ts:326-348`](file:///Users/sajid/Developer/personal/tabitat/src/background/workspace-engine.ts#L326-L348), remove all created placeholder tabs (`op.createdTabIds`) from the live window or decouple the window to an Unsorted workspace upon abandon, preventing `from` from absorbing `to`'s tabs on auto-save.
5. **Enforce Epoch Validation in `ownerOf` and `nextWorkspace`**:
   - In [`src/background/workspace-engine.ts:570-575`](file:///Users/sajid/Developer/personal/tabitat/src/background/workspace-engine.ts#L570-L575) and [`src/background/workspace-engine.ts:691-696`](file:///Users/sajid/Developer/personal/tabitat/src/background/workspace-engine.ts#L691-L696), verify `st.sessionEpoch === this.ctx.epoch` so that stale records from prior browser sessions do not throw false `conflict` errors or block workspace navigation.
6. **Eliminate In-Memory `mayHavePendingOps` Guard**:
   - In [`src/background/workspace-engine.ts:268`](file:///Users/sajid/Developer/personal/tabitat/src/background/workspace-engine.ts#L268) and [`src/background/workspace-engine.ts:421`](file:///Users/sajid/Developer/personal/tabitat/src/background/workspace-engine.ts#L421), remove the `if (!this.mayHavePendingOps) return;` short-circuit so that revived workers always query `repo.listOps()` during alarms and tab replacements.
7. **Prevent Atomic Deletion Race in `quarantine()`**:
   - In [`src/background/repository.ts:1612`](file:///Users/sajid/Developer/personal/tabitat/src/background/repository.ts#L1612), do not call `store.remove(key)` when a `salvage` function is provided; write the salvaged record directly over `key` to avoid a crash window where the key is missing.
8. **Sanitize `favIconUrl` in Core Domain**:
   - In [`src/core/ops/snapshot.ts:3661-3663`](file:///Users/sajid/Developer/personal/tabitat/src/core/ops/snapshot.ts#L3661-L3663) and [`src/core/model/schemas.ts:4078`](file:///Users/sajid/Developer/personal/tabitat/src/core/model/schemas.ts#L4078), sanitize favicons to allowed schemes (`http:`, `https:`, `chrome:`, `chrome-extension:`) and strip `data:` URLs before building `SavedTab` objects.
9. **Recoverable `ReadyBarrier` Error Handling**:
   - In [`src/background/ready.ts:53-61`](file:///Users/sajid/Developer/personal/tabitat/src/background/ready.ts#L53-L61), allow `ReadyBarrier` to clear its rejection on subsequent events or alarms so that a single initialization failure does not brick the service worker permanently.
10. **Refine Reconciler Hint Scoring Against Total Window Tabs**:
    - In [`src/core/reconcile/matcher.ts:3922`](file:///Users/sajid/Developer/personal/tabitat/src/core/reconcile/matcher.ts#L3922), score placeholder hints against total non-pinned tabs (`window.tabs.length`) rather than only against `placeholders`, preventing a single stale placeholder tab from overriding a window containing 19 loaded tabs.
