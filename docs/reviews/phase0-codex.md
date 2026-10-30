## 1. Verdict in 3 lines

The stack is suitable, but the architecture is not ready for destructive workspace switching.  
Sections 5–6 contain concurrency and recovery gaps that can overwrite saved workspaces or lose recovery state.  
Approve the direction; require a durable switch protocol and failure-tested persistence before building the dashboard.

## 2. Critical flaws

### Autosave can overwrite a workspace during switching — §§5.3–5.4

Opening incoming tabs fires tracking events while `activeWorkspaceId` still identifies the outgoing workspace. Autosave can therefore replace the outgoing snapshot with a mixture of both workspaces. Closing outgoing tabs produces further races.

**Fix:** Serialize operations per window and affected workspace. Persist a switch operation before side effects; prevent intermediate window states from becoming authoritative snapshots. Record external user changes during switching and reconcile them before committing. Suppressing all events indiscriminately would lose legitimate changes.

### The recovery journal does not survive the failures it must recover from — §§5.2, 6

`storage.session` survives worker termination, but clears on browser restart, extension reload, disable, and update. Consequently, `rt:journal` cannot support the advertised crash/update recovery. A single journal also cannot represent simultaneous switches in different windows. [Chrome storage documentation](https://developer.chrome.com/docs/extensions/reference/api/storage)

**Fix:** Persist one operation record per switch in durable storage, including immutable source/target snapshots, operation ID, stage, and tab-operation progress. Await persistence before closing anything.

Creating a tab and recording its ID are separate operations: termination between them can cause duplicates on retry. Give placeholders deterministic operation/tab identities and reconcile existing tabs before creating replacements. Never blindly replay old browser tab IDs after restart.

### Version counters do not prevent lost updates — §5.1

Two surfaces can read revision 7, independently modify the same workspace, and both write revision 8. One update disappears. Serializing individual storage calls does not serialize an entire read–modify–write sequence; the API supplies no compare-and-swap operation. [Storage API reference](https://developer.chrome.com/docs/extensions/reference/api/storage)

**Fix:** Route all canonical mutations through the worker and explicitly serialize handlers. A single worker still permits asynchronous handlers to interleave. Keep optimistic UI state, but acknowledge success only after persistence; reject stale edits or preserve conflicting note drafts.

### Create-then-discard is not lazy creation — §§5.3, 9

`active:false` does not prevent navigation. Discarding afterward cannot guarantee that no network requests or page scripts ran. Activating the restored tab reloads discarded content, contradicting “no tab ever loads content.” [Tabs API](https://developer.chrome.com/docs/extensions/reference/api/tabs)

**Fix:** Create extension placeholders directly for inactive restored tabs. Store original URLs durably and reference them by opaque saved-tab ID. Activate/load only the selected tab. Snapshot placeholders as their original saved records, never as `chrome-extension://…` URLs.

### The autosave debounce does not work as specified — §5.4

A `when` timestamp does not bypass production alarm throttling. The documented minimum is 30 seconds from Chrome 120, and unpacked development extensions can conceal this problem. [Alarm scheduling restrictions](https://developer.chrome.com/docs/extensions/reference/api/alarms?authuser=17)

**Fix:** Persist recoverable changes promptly; debounce expensive snapshot compaction using a short best-effort timer, backed by durable pending work and an alarm. State the actual recovery-point objective. A session-only dirty set plus delayed snapshot cannot guarantee recovery after browser failure.

### Session recovery cannot depend on a clean-shutdown flag — §5.6

There is no dependable final asynchronous browser-shutdown save in this design. Worker shutdown is also not browser shutdown. By `windows.onRemoved`, querying all windows cannot recover the removed window’s tabs.

**Fix:** Retain the last known window state before closure events empty it. Preserve previous-session generations separately from current snapshots; do not let startup’s empty state overwrite recovery candidates. Offer recovery based on available checkpoints and unfinished operations, not an asserted crash detector. MV3 requires resilience to unexpected termination. [Worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)

### Closing tabs necessarily loses more than URLs — §§1, 2.1, 5.3

URL/title snapshots cannot reconstruct unsaved forms, page application state, or navigation history. Two windows opening the same workspace can also overwrite its single `tabs` array.

**Fix:** Define v1 as saved-tab recovery, explicitly excluding full page-state preservation. Require one live owner window per workspace; opening an owned workspace should focus that window or explicitly clone it. Specify pinned-tab and unsaved-work behavior before shipping destructive switching.

### Manifest and placeholder defects — §§4, 8

Standard commands require descriptions; all four examples omit them. `commands` belongs in the manifest’s command declaration, not the permissions array. [Commands documentation](https://developer.chrome.com/docs/extensions/reference/api/commands)

If “placeholder … inline” means inline JavaScript, navigation will fail under the default extension CSP. Use a packaged script. Inline critical CSS is a separate matter and can remain. [Extension CSP](https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy)

## 3. Answers to the eight open questions in §12

1. **New-tab override:** Choose two build flavors if optional replacement is mandatory; make the default flavor omit the override and expose the dashboard as a normal extension page. There is no supported runtime toggle for the manifest override. Disabling the extension disables Tabitat, not just its dashboard. Avoid internal-NTP redirect tricks. Explain that separately installed flavors have separate data and need export/import transfer. [Override documentation](https://developer.chrome.com/docs/extensions/develop/ui/override-chrome-pages)

2. **Lazy restore:** Use placeholders from the outset. Reserve `tabs.discard` for already-open tabs. This is the defensible way to guarantee no background destination navigation; actual behavior across named Chromium forks still needs testing. Specify activation, missing-record recovery, and extension-uninstall limitations.

3. **Preact/signals versus Solid/Svelte:** Keep Preact/signals. Nothing in these interfaces justifies a framework migration. Browser operations and storage correctness dominate risk. Each surface has its own signals instance; shared component code does not provide shared runtime state.

4. **Storage granularity:** Keep one key per workspace rather than one giant blob. It bounds rewrite and notification payloads at 2,500 tabs. Separate frequently edited metadata/resources from tab snapshots if measurements justify it. Store recovery snapshots separately with a bounded index instead of repeatedly rewriting the entire ring.

5. **Direct UI writes:** Reject them for canonical state. Use worker commands for notes, todos, settings, and renames too. Explicit serialization plus expected revisions provides meaningful conflict handling; a counter embedded in unrestricted writes does not.

6. **Workspace equals tab group:** Do not make them equivalent in v1. A workspace should contain multiple groups. Keeping inactive workspaces open preserves more live state but consumes tab-strip space and potentially memory; discarding sacrifices some of that fidelity. Treat it as a future retention strategy.

7. **Lifecycle plan:** Keep synchronous listener registration. Add an initialization/reconciliation barrier, resumable migrations, durable operation records, alarm repair, and recovery on ordinary worker wakeups. In-memory queues/caches are acceptable when reconstructible; banning mutable module state is unnecessarily broad. Recreate missing alarms and derive timers from persisted deadlines. [Alarm persistence](https://developer.chrome.com/docs/extensions/reference/api/alarms)

8. **Chrome minimum:** Raise the functional floor to **121**, because §5.5 uses `tabs.lastAccessed`, introduced there. If a custom command must invoke `action.openPopup()`, use **127** or use `_execute_action` instead. Chrome version alone does not establish fork compatibility; publish a tested capability matrix and provide a full-page fallback for unavailable side panels. [Tabs reference](https://developer.chrome.com/docs/extensions/reference/api/tabs), [popup availability](https://developer.chrome.com/docs/extensions/reference/api/action)

## 4. Tech-stack challenges

| Choice | Recommendation |
|---|---|
| **WXT** | **Keep.** Inspect generated production manifests and pin versions. Update the testing imports: current WXT uses `wxt/testing/fake-browser` and `wxt/testing/vitest-plugin`; the barrel import was removed. Drop the unsupported maintenance comparison with CRXJS. [WXT upgrade guide](https://wxt.dev/guide/resources/upgrading) |
| **Preact + signals** | **Keep.** Use signals for each surface’s view state, with revision-aware storage hydration. Subscribe before initial reads and reconcile events arriving during hydration. |
| **Valibot** | **Keep.** Validate command payloads, imports, persisted records, and migration outputs—not merely message names. Add size limits and referential-integrity checks. |
| **fuzzysort** | **Keep.** Benchmark real titles and URLs. Choose where the index lives: §5.1 favors local UI reads, while §7 sends queries to the worker. Avoid rebuilding the complete index on every keystroke. |
| **Biome** | **Keep.** Retain separate TypeScript checking and security-focused tests. Text searches banning `fetch(` cannot enforce a no-network policy. |
| **Storage layout** | **Keep `storage.local` for v1, amend its protocol.** Use durable operation records and immutable generations with a committed pointer for migrations/imports. Choose IndexedDB transactions if this becomes too complex; transactions still cannot atomically include browser tab operations. |

Replace “synchronous-enough” in §3 with an explicit asynchronous consistency model. Treat dependency-size estimates as provisional measurements, not architectural guarantees.

## 5. Missing pieces a v1 must have

- **Stable identities (§6):** Add saved-tab IDs, `activeTabId`, and group IDs independent of Chrome IDs. Identical URLs cannot identify the active tab; identical group names/colors must not merge separate groups. Preserve group order and collapsed state.
- **Recovery semantics (§§5–6):** Define empty workspaces, partially restored workspaces, failed closes, tabs moved between windows, user navigation during switching, and unavailable URLs. Never delete the only durable recovery copy.
- **Safe suspension (§5.5):** Default automatic suspension off. Explicitly respect exclusion settings and `autoDiscardable`; do not imply a 30-minute delay protects forms.
- **RPC completion (§7):** Define runtime validation, error envelopes, durable request deduplication, retry behavior, and operation-status lookup. A lost response is not proof that a command failed.
- **Migration/import safety (§6):** Stage and validate before commit; preserve the previous generation. Gate writes during migration and resume after interruption. Specify merge versus replace, unknown schema versions, wallpaper inclusion, and malformed backups.
- **Privacy/security (§10):** Explicitly exclude incognito persistence in v1. Use an allowlist for navigation schemes and render titles/notes safely. Disable remote Markdown images; restrict network resource loading through CSP. Optional settings sync is an exception to “all data stays in the browser.”
- **User recovery controls (§2):** Provide undo for workspace deletion and duplicate closing, backup reminders, save-failure visibility, and a recovery screen that remains usable when normal initialization fails.

## 6. Phase plan feedback

Section 11 puts safety behind polish. Move session recovery, export/import, migrations, and failure handling into Phase 1, before destructive switching is usable.

Add a Phase 0 browser spike: placeholder restoration, packaged alarm behavior, command activation, side-panel capability, and worker restart during switching.

Phase 1’s gate should inject failure before and after every destructive operation and storage commit. Test worker termination, browser restart, update, storage rejection, simultaneous commands, and user tab movements. Coverage percentages and fake-browser tests cannot demonstrate these properties.

Phase 2 should deliver the complete workspace/recovery experience. Defer dashboard widgets and settings sync until that is stable. Run accessibility checks throughout UI development.

Rewrite §9 around reproducible p95 measurements on specified hardware and datasets. Separate UI acknowledgement, durable commit, and restore completion. The one-storage-key popup assumption contradicts §6; the 500 ms switch target is unproven.

## 7. Top 10 concrete document changes, ranked

1. **§§5.2–5.3:** Replace the six-step switch with a durable, resumable state machine and explicit invariants.
2. **§§5.1, 7:** Route canonical mutations through serialized worker commands; define conflicts and retries.
3. **§§5.3–5.4:** Specify autosave isolation and reconciliation during switching.
4. **§§5.6, 6:** Replace clean-shutdown detection with preserved recovery generations and startup reconciliation.
5. **§§5.3, 9:** Adopt direct placeholder restoration and remove the create/discard no-load guarantee.
6. **§§5.4, 6:** Replace the 1–2-second alarm debounce with durable pending changes and realistic scheduling.
7. **§§2, 6:** Define workspace ownership, stable tab/group identity, pinned-tab policy, and restoration limits.
8. **§§4, 8:** Fix commands/CSP issues, raise the API baseline, and decide the new-tab distribution model.
9. **§§6, 10:** Specify interruption-safe migrations/imports, URL rules, incognito handling, and sync exceptions.
10. **§§9, 11:** Move safety into Phase 1 and replace coverage-led gates with failure-recovery acceptance tests.
