### 1. Verdict

Yes, Phase 1 is architecturally trustworthy and ready to support the Phase 2 UI build.
The fix pass systematically addressed every data-loss vector, making crash recovery, window closure rescue, and switch isolation durable and deterministic.
Before shipping Phase 2 UI code against this base, two high-severity type mismatches in `salvage.ts` must be patched to prevent valid tabs from falling through salvage into destructive quarantine.

---

### 2. Status of Original Top-10 Items

#### 1. Workspace quarantine wipeout — **Fixed**
* **Evidence:** `===== FILE: src/background/salvage.ts (full, after fixes) =====` L89–L104; `===== FILE: src/background/repository.ts (full, after fixes) =====` L85–L112.
* **Analysis:** Corrupt `ws:tabs` entries are no longer discarded on validation errors. `salvageWorkspaceTabs` inspects entries item-by-item, recovers every valid tab, regenerates non-colliding duplicate IDs with `freshId()`, and falls back to a clean placeholder tab only if zero tabs are salvageable. In `Repository.validate()`, the salvaged record and dropped items (`corrupt:<key>`) are written atomically in a single `store.set()` call without removing the live key.

#### 2. Trash on replace-import — **Fixed**
* **Evidence:** `===== FILE: src/background/backup.ts (full, after fixes) =====` L128–L158.
* **Analysis:** When `mode === 'replace'`, `importBackup` calls `takeGeneration()` to capture a complete snapshot of all existing workspaces, creates a unique backup archive ID, and writes the entire previous state into `Keys.trash` before staging the import in `Keys.importStaging`. Any replace action is fully undoable from trash.

#### 3. Rescue on window removal — **Fixed**
* **Evidence:** `===== FILE: src/background/tab-tracker.ts (full, after fixes) =====` L518–L586.
* **Analysis:** `handleWindowRemoved` uses synchronous session cache lookups (`lastKnownWindow(windowId)`) backed by event-driven session storage (`lk:<id>`). Unsaved tab state (<750ms debounce window) is flushed directly to `ws:tabs:<id>` for active workspaces or to `Keys.recentlyClosed` and `Keys.trash` for unsorted windows. In addition, `closedWhileAway` detects and recovers any windows closed while the service worker was suspended.

#### 4. Abandoned-switch contamination — **Fixed**
* **Evidence:** `===== FILE: src/background/workspace-engine.ts (full, after fixes) =====` L296–L306; `===== FILE: src/background/tab-tracker.ts (full, after fixes) =====` L302–L327; Diff L3316–L3324.
* **Analysis:** An aborted or crashed switch immediately calls `detach(windowId, 'abandoned-switch')`, setting `activeWorkspaceId: null` so the window transitions safely to Unsorted. `snapshotOptsFor` explicitly ignores placeholder tabs belonging to foreign workspaces, preventing partial switch tabs from being saved into either workspace.

#### 5. Epoch validation in `ownerOf` — **Fixed**
* **Evidence:** `===== FILE: src/background/workspace-engine.ts (full, after fixes) =====` L860–L878.
* **Analysis:** `liveWindowStates()` queries the browser's live windows and filters out any window state where `st.sessionEpoch !== this.ctx.epoch` or `!live.has(windowId)`. `ownerOf(workspaceId)` only returns a window ID if that window passes live epoch verification, eliminating false ownership conflicts from prior browser sessions.

#### 6. `mayHavePendingOps` guard — **Fixed**
* **Evidence:** `===== FILE: src/background/workspace-engine.ts (full, after fixes) =====` L349–L365; Diff L2458–L2461, L2495–L2508.
* **Analysis:** The volatile in-memory boolean flag was eliminated. `resumePending()` queries durable `op:switch:*` keys directly from `storage.local` on startup, and `flushAll()` iterates over persisted `dirty:*` markers. State recovery does not depend on memory flags surviving service worker restarts.

#### 7. Quarantine ordering — **Fixed**
* **Evidence:** `===== FILE: src/background/repository.ts (full, after fixes) =====` L101–L108, L130–L147.
* **Analysis:** `quarantine()` copies the corrupted value to the quarantine key (`corrupt:<key>`) *before* executing `store.remove(key)`. If `store.set(target, ...)` fails, the original key is never removed. Furthermore, `validate()` sets the salvaged record and dropped items in the same call without calling remove.

#### 8. Favicon sanitising — **Fixed**
* **Evidence:** `===== FILE: src/entrypoints/suspended/main.ts (full, after fixes) =====` L21; Diff L3057–L3061, L3539–L3551, L3576–L3580.
* **Analysis:** `isAllowedFavIconUrl` aligns snapshot validation with the schema allowlist (`https:`, `http:`, `chrome:`). In `suspended/main.ts`, `faviconPageUrl()` strips all query parameters and hash fragments before querying `chrome-extension://<id>/_favicon/`, preventing URL leakage and CSP rejection.

#### 9. Recoverable ReadyBarrier — **Fixed**
* **Evidence:** `===== FILE: src/background/ready.ts (full, after fixes) =====` L38–L98; Diff L1431–L1436, L1461–L1467, L1697–L1699.
* **Analysis:** If `services.init()` fails, `ready()` resolves `{ degraded: true }` rather than permanently rejecting. `command-router.ts` permits non-destructive read operations (`system.ping`, `op.status`, `backup.export`) while rejecting mutations with `NotReadyError`. Readiness retries automatically on incoming commands or alarm triggers.

#### 10. Hint scoring — **Fixed**
* **Evidence:** Diff `src/background/matcher.ts` L3610–L3644.
* **Analysis:** Scoring denominator is now `counted` (total non-pinned, non-blank tabs in the window) rather than `placeholders.length`. The heuristic requires a strict majority (`best[1] * 2 > counted`), preventing a single isolated placeholder from claiming an unrelated window.

---

### 3. New Bugs Introduced by the Fix Pass

#### Bug 1: Float/Negative Timestamp Rejection Triggers Destructive Quarantine
* **File & Line:** `src/background/salvage.ts`, L42–L43, L94, L123–L124.
* **Scenario:** `salvageWorkspaceTabs` and `salvageWorkspaceMeta` use `finite(raw.updatedAt, now)` and `finite(raw.createdAt, now)`. `finite()` accepts floating-point numbers (e.g., `1730000000.5` from high-precision clocks) and negative numbers. However, the post-salvage schema checks `isWorkspaceTabs(salvaged)` (L103) and `isWorkspaceMeta(salvaged)` (L134) enforce `TimestampSchema`, which resolves to `NonNegInt` (`Math.floor(n) === n && n >= 0`). A float or negative timestamp passes field salvage but fails schema validation, causing salvage to return `null`. In `repository.ts` L110, `salvaged === null` triggers `await this.quarantine(key)`, wiping the live record and dropping all valid tabs.
* **Severity:** **High** (Violates "never lose a tab" on clock precision quirks).
* **Fix:** In `salvage.ts`, define helper `const nonNegInt = (v: unknown, fallback: number): number => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : fallback;` and use it for `updatedAt` and `createdAt`.

#### Bug 2: Missing or Undefined `raw.id` in `salvageWorkspaceMeta` Aborts Salvage
* **File & Line:** `src/background/salvage.ts`, L118.
* **Scenario:** `salvageWorkspaceMeta(id, raw, now)` validates the record header with:
  ```ts
  if (!isRecord(raw) || !isValidId(id) || raw.id !== id) return null;
  ```
  If storage metadata has a missing, null, or corrupted `raw.id` field, `raw.id !== id` evaluates to true. Instead of defaulting `raw.id` to the trusted `id` parsed from the storage key (`ws:meta:<id>`), the function returns `null`. `repository.ts` quarantines and removes the metadata, orphaning all tabs in `ws:tabs:<id>`.
* **Severity:** **Medium-High** (Causes workspace disappearance when metadata has missing id property).
* **Fix:** Allow `raw.id` to be absent or undefined:
  ```ts
  if (!isRecord(raw) || !isValidId(id) || (raw.id !== undefined && raw.id !== id)) return null;
  ```
  Then assign `id: id` unconditionally.

#### Bug 3: `Keys.wsPrev(id)` Leak on Workspace Deletion
* **File & Line:** `src/background/workspace-engine.ts`, L941.
* **Scenario:** `deleteWorkspace(id)` deletes `[Keys.wsMeta(id), Keys.wsTabs(id)]`. If the workspace underwent provisional reconciliation before deletion, `Keys.wsPrev(id)` remains orphaned in `storage.local`.
* **Severity:** **Low** (Harmless storage leak; no data loss).
* **Fix:** Include `Keys.wsPrev(id)` in the removal array:
  ```ts
  await this.ctx.store.remove([Keys.wsMeta(id), Keys.wsTabs(id), Keys.wsPrev(id)]);
  ```

---

### 4. Remaining Must-Fix Before Phase 2

1. **Patch `salvage.ts` Timestamp Sanitizer (`finite` $\rightarrow$ `nonNegInt`):**
   * *Justification:* Essential to ensure `isWorkspaceTabs` and `isWorkspaceMeta` never reject a salvaged record due to float timestamps, avoiding unnecessary quarantine fallbacks.
2. **Patch `salvage.ts` Metadata ID Defaulting:**
   * *Justification:* Prevents valid workspace tab sets from being orphaned if `ws:meta:<id>` has an undefined or corrupt `id` property.

---

### 5. Deferrable Items

1. **CDP-based Service Worker Termination Test Harness:** Deferred to Phase 3 integration testing. The state machine now handles recovery synchronously from storage markers.
2. **`Keys.wsPrev` Storage Cleanup:** Stale reconciliation keys do not affect runtime correctness or tab integrity; can be cleaned up during scheduled housekeeping.
3. **Backup Export Query-Parameter Stripping:** Exported favicons in backups do not trigger extension CSP issues.
4. **`file://` URL Warning on Import:** Can be handled as a UI notification when building the Phase 2 import modal.
