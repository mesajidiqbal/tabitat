## (1) Verdict

Phase 2 demonstrates a clean Preact/Signals foundation with zero runtime dependencies, robust local favicon handling, and strict adherence to avoiding direct `chrome.storage` writes. However, it cannot be approved for production in its current state due to critical search breakage (`fuzzysort` threshold), omitted active Unsorted workspaces in the store, and subtle window tracking/storage subscription races. Resolving these correctness bugs alongside several ARIA listbox/option hierarchy violations is required before release.

---

## (2) Correctness Bugs

### Bug 1: Fuzzysort score threshold breaks workspace search completely
- **File & Line**: `src/ui/search.ts:125`
- **Scenario**: When typing in the search box, `search()` attempts to match workspace names via `fuzzysort.single(needle, m.name)`. In `fuzzysort`, scores are non-positive integers where `0` is a perfect match and negative numbers indicate lower similarity (e.g. `-100`). The check `if (r && r.score >= 0.3)` will **never** evaluate to `true` for any workspace match (even an exact match scores `0 < 0.3`).
- **Severity**: **Critical**. Workspaces never appear in search results under any query.
- **Fix**: Change the threshold comparison to use fuzzysort's negative scale or null check:
  ```ts
  if (r && r.score > -1000) {
  ```

### Bug 2: Active Unsorted workspace is omitted from `workspaces` signal and disappears from UI
- **File & Line**: `src/ui/store.ts:86-90`
- **Scenario**: Unsorted workspaces are managed dynamically per window and are not stored in `ws:index` (which only indexes named workspaces). When the current window is in an Unsorted workspace, `activeWorkspaceId.value` is `"unsorted:<windowId>"`. Because `workspaces` computes its list strictly from `store.index.value.map(id => metas[id])`, `list.findIndex(m => m.id === active)` returns `-1`. The active workspace is completely omitted from `workspaces`, meaning `WorkspacesSection` fails to render the current window's active workspace.
- **Severity**: **High**. Core UI-SPEC invariant violated: the active workspace must always be displayed at the top with a filled indicator (`●`).
- **Fix**: In the `workspaces` computed signal, verify if `active` exists in `store.metas.value` and is absent from `list`. If so, prepend it:
  ```ts
  export const workspaces = computed(() => {
    const metas = store.metas.value;
    const list = store.index.value.map((id) => metas[id]).filter((m): m is WorkspaceMeta => !!m);
    const active = activeWorkspaceId.value;
    const activeMeta = active ? metas[active] : null;
    const i = list.findIndex((m) => m.id === active);
    if (i > 0) list.unshift(...list.splice(i, 1));
    else if (i === -1 && activeMeta) list.unshift(activeMeta);
    return list;
  });
  ```

### Bug 3: Stale window ID handling on window destruction and focus change
- **File & Line**: `src/ui/store.ts:276-288`
- **Scenario**:
  1. `chrome.windows.onRemoved.addListener` updates `liveWindowIds`, but if the closed window is `store.windowId.peek()`, `store.windowId` is not reset or re-resolved. Subsequent operations (`switchTo`, `tabs.suspendOthers`, polling) send dead window IDs to the worker.
  2. `chrome.windows.onFocusChanged` receives `windowId: number`, but line 278 ignores the argument and calls `resolveWindowId()`, which calls `chrome.windows.getCurrent()`. In side panels and popups, `getCurrent()` returns the window associated with the surface document—not the newly focused browser window. `w !== store.windowId.peek()` never triggers.
- **Severity**: **High**.
- **Fix**: Handle current window removal in `onRemoved` by falling back to `chrome.windows.getLastFocused()`, and consume `windowId` in `onFocusChanged`:
  ```ts
  chrome.windows.onRemoved.addListener((id) => {
    store.liveWindowIds.value = store.liveWindowIds.peek().filter((x) => x !== id);
    if (store.windowId.peek() === id) {
      void chrome.windows.getLastFocused({ windowTypes: ["normal"] }).then((w) => selectWindow(w?.id ?? null));
    }
  });
  chrome.windows.onFocusChanged.addListener((wid) => {
    if (fixed || wid === chrome.windows.WINDOW_ID_NONE) return;
    if (wid !== store.windowId.peek()) void selectWindow(wid);
  });
  ```

### Bug 4: Initial read vs. `onChanged` race condition in `useStorageKey` and `Quarantine`
- **File & Line**: `src/ui/hooks/useStorageKey.ts:45-50`, `src/entrypoints/recovery/Quarantine.tsx:17-33`
- **Scenario**: In both hooks, `chrome.storage.onChanged.addListener` is registered at mount, and `chrome.storage.local.get` is called asynchronously. If storage updates between listener registration and `get()` resolution, `onChanged` updates state first with fresh data. When the initial `get()` promise later resolves, it invokes `apply()` with stale data, clobbering the newer state.
- **Severity**: **Medium**.
- **Fix**: Track an initial load flag or timestamp in `useStorageKey` and `useCorrupt` so that initial `get()` resolution ignores keys that have already been updated by `onChanged`:
  ```ts
  let initialLoaded = false;
  void chrome.storage.local.get(key).then((res) => {
    if (!alive || initialLoaded) return;
    apply(res[key]);
  });
  const listener = (changes, area) => {
    if (area !== "local" || !(key in changes)) return;
    initialLoaded = true;
    apply(changes[key]?.newValue);
  };
  ```

### Bug 5: Unsorted workspaces permit deletion via shortcut and context menu
- **File & Line**: `src/ui/components/WorkspaceRow.tsx:48, 120-127`
- **Scenario**: For Unsorted rows (`meta.kind === "unsorted"`), pressing `Delete` (line 48) invokes `deleteWorkspace(meta.id, name)`. Similarly, the `Menu` item list includes "Delete" without checking `unsorted`. Unsorted workspaces represent current window state; sending `workspace.delete` causes backend schema/logic errors or leaves orphaned tabs.
- **Severity**: **Medium**.
- **Fix**: Guard keyboard deletion with `!unsorted`, and filter out or disable the delete menu item:
  ```ts
  else if (k === "Delete" && !unsorted) void deleteWorkspace(meta.id, name);
  ```
  ```ts
  ...(!unsorted ? [{
    label: t("delete"),
    danger: true,
    hint: <Kbd>Del</Kbd>,
    disabled: p.disabled,
    onSelect: () => void deleteWorkspace(meta.id, name),
  }] : []),
  ```

### Bug 6: Op polling timer leak on failure or prolonged side panel residency
- **File & Line**: `src/ui/store.ts:189-206`
- **Scenario**: `poll()` runs every 100 ms while `keep` is true (`store.opLive`, `store.opRecord`, or `store.pendingSwitch`). If `send("op.status")` throws or the worker experiences transient lag, `catch` resets `opLive.value = null`, but `opRecord` may still be set in storage. Furthermore, there is no maximum timeout or unmount cleanup for the recursive `setTimeout` chain in persistent side panels.
- **Severity**: **Medium**.
- **Fix**: Introduce a watchdog iteration cap or timeout (e.g. max 30 seconds of polling per op) and cancel any scheduled timer when switching windows or tearing down.

### Bug 7: Error surfacing completely suppressed during search
- **File & Line**: `src/ui/actions.ts:44`, `src/entrypoints/popup/App.tsx:35-44`, `src/entrypoints/sidepanel/App.tsx:36-45`
- **Scenario**: When an RPC mutation fails, `attempt()` sets `uiError.value = errorText(e)`. In both `popup/App.tsx` and `sidepanel/App.tsx`, `uiError` is rendered exclusively inside `<WorkspacesSection>`. When `searching` is active (`query.trim() !== ""`), `<SearchResults>` replaces `<WorkspacesSection>`. If an action executed from search results (such as `openHit` calling `switchTo` or `activateByUrl`) fails, `uiError` is set in memory but not rendered anywhere.
- **Severity**: **Medium**.
- **Fix**: Render the error banner outside of `<WorkspacesSection>` at the top level of `App.tsx` (e.g., directly below `SearchBox` or above `RecoveryBanner`).

---

## (3) Architecture-Rule Violations

1. **Direct Tab Removal Bypasses RPC Boundary**:
   - `src/ui/sections/TabsSection.tsx:35`: `run: () => void chrome.tabs.remove(tab.id)`.
   - **Violation**: UI-SPEC §Shared read model explicitly states: *"reading tabs is allowed in UI, writing is not"*. While tab activation via `chrome.tabs.update` is permitted in `actions.ts`, closing tabs mutates window state without passing through the worker's transactional lanes or tab-tracker reconciler. If a `tabs.close` command exists or is introduced, it must be used via `send()`.
2. **Side Panel Gesture and Window Readiness**:
   - `src/ui/actions.ts:63-65`: `openSidePanel()` invokes `chrome.sidePanel.open({ windowId: w })`.
   - **Violation**: While called synchronously from click handlers, `w` is fetched via `store.windowId.peek()`. If clicked immediately upon popup load before `resolveWindowId()` finishes, `w === null` causes silent failure. Furthermore, triggering `openSidePanel()` from the document `'s'` keydown listener in `useSurface.ts:46` can fail in Chrome versions that reject document-level key events as transient user activations for side panel opening.
3. **Popup First Paint Layout Shift**:
   - `src/entrypoints/popup/main.tsx:9-10`: `Promise.race([ready, new Promise((r) => setTimeout(r, 150))])`.
   - **Violation**: If storage retrieval takes longer than 150 ms, `render(<App />, root)` proceeds while `store.ready.value === false`. Because `App.tsx` and `WorkspacesSection.tsx` lack skeleton layout reservations or readiness checks, the UI renders `EmptyState` ("No workspaces yet") and then abruptly shifts into populated rows when storage resolves, violating the *"no layout shift"* rule.

---

## (4) Accessibility Issues with Concrete Fixes

1. **Interactive Elements Nested Inside `role="option"`**:
   - **File & Line**: `src/ui/components/WorkspaceRow.tsx:62-104`, `src/ui/components/TabRow.tsx:62-113`
   - **Issue**: Both rows declare `role="option"`, but contain interactive buttons (`IconButton`, `Menu` trigger, swatch buttons, inline rename `<input>`). According to the W3C ARIA specification, `role="option"` elements must not contain interactive child elements. Screen readers either ignore inner controls or fail listbox navigation.
   - **Concrete Fix**: Either transition the list structure to `role="grid"` with `role="row"` and `role="gridcell"` (the APG composite pattern for rows with interactive action buttons), or remove `role="option"` from the row container when actions are present and rely on standard button roving tabindex.
2. **Dangling `aria-controls` Reference on Combobox**:
   - **File & Line**: `src/ui/components/SearchBox.tsx:34`
   - **Issue**: `aria-controls={p.listId}` unconditionally points to `"search-results"`. When `query` is empty, `SearchResults` is not mounted in `App.tsx`, leaving an invalid ARIA pointer.
   - **Concrete Fix**:
     ```tsx
     aria-controls={open ? p.listId : undefined}
     ```
3. **Invalid Direct Children of `role="listbox"` in Empty State**:
   - **File & Line**: `src/ui/sections/SearchResults.tsx:19-21`
   - **Issue**: When `hits.length === 0`, `<div role="listbox">` directly encloses `<EmptyState>`, rendering raw `<div>` and `<p>` elements. The only permitted children of `role="listbox"` are `role="option"` or `role="group"`.
   - **Concrete Fix**: Do not assign `role="listbox"` when there are no items; render `EmptyState` with `role="status"`:
     ```tsx
     if (p.hits.length === 0) {
       return (
         <div id={RESULTS_ID} role="status" aria-label={t("searchResults")}>
           <EmptyState title={t("noResults")} hint={t("noResultsHint")} />
         </div>
       );
     }
     ```
4. **`TabGroupHeader` Button Breaches Listbox Roving Tabindex**:
   - **File & Line**: `src/ui/sections/TabsSection.tsx:80-97`, `src/ui/components/TabGroupHeader.tsx:17-25`
   - **Issue**: The group header is rendered as an HTML `<button>` inside `<div role="group">` inside the `listbox`. Because `useRoving` only indexes visible `UiTab` items, the header button defaults to `tabIndex={0}`, creating an inconsistent dual-tabstop behavior where Arrow keys skip the group header while Tab stops on it.
   - **Concrete Fix**: Include group headers as navigable nodes in `useRoving` with `tabIndex={cur === headerIndex ? 0 : -1}`, or extract group headers outside of the `role="listbox"` container.

---

## (5) UX Issues Against Spec

1. **Unsorted Workspaces of Other Windows Lack Identification**:
   - **File & Line**: `src/ui/components/WorkspaceRow.tsx:38`
   - **Issue**: Other windows' unsorted sessions render as `t("unsortedOther")` ("Unsorted (other window)"). When multiple windows are open, users see multiple identical rows labeled "Unsorted (other window)" with no window title, index, or differentiator.
   - **Fix**: Append window numbers or primary active tab titles: e.g., `t("unsortedOtherNumbered", windowIndex)`.
2. **Silent Failure on Undo Action**:
   - **File & Line**: `src/ui/actions.ts:1129`, `src/ui/components/Toast.tsx:55`
   - **Issue**: Clicking "Undo" on workspace/link deletion dismisses the toast and calls `trash.restore`, but displays no confirmation feedback upon success. If `trash.restore` fails, the error goes to `uiError` without notifying the user why undo failed.
   - **Fix**: Chain `.then(() => showToast({ message: t("restoredSuccess") }))` on the undo action handler.
3. **Menu Wrapper Space Key Conflict**:
   - **File & Line**: `src/ui/components/Menu.tsx:84`
   - **Issue**: `onKeyDown={(e) => e.key === "Enter" && e.stopPropagation()}` stops Enter from activating parent row elements, but allows `Space` to bubble. Pressing Space on the menu trigger button activates the row behind it in addition to toggling the menu.
   - **Fix**: Stop propagation for Space as well:
     ```tsx
     onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && e.stopPropagation()}
     ```

---

## (6) Performance Concerns

1. **Re-render Storms from Unmemoized Computations on Tab Events**:
   - **File & Line**: `src/ui/sections/WorkspacesSection.tsx:26`, `src/ui/sections/WindowActions.tsx:14`
   - **Issue**: Any tab title, audio, or favicon update in Chrome triggers `scheduleTabs()`, pushing a fresh array reference into `store.liveTabs`. In `WorkspacesSection`, `liveCount` filters `store.liveTabs.value` on every render. In `WindowActions`, `duplicateCount()` performs full URL parsing and grouping on every render.
   - **Fix**: Convert both into computed signals in `store.ts`:
     ```ts
     export const liveTabCount = computed(() =>
       store.liveTabs.value.filter((x) => !x.pinned && !isBlankPageUrl(x.url)).length
     );
     export const windowDuplicates = computed(() =>
       duplicateCount(store.liveTabs.value, chrome.runtime.getURL("/suspended.html"))
     );
     ```
2. **Search Index Reactivity Cascades on First Keystroke**:
   - **File & Line**: `src/ui/search.ts:53-121`
   - **Issue**: On the first keystroke, `search()` calls `untracked(start)`, which registers 4 reactive effects. Each effect immediately invokes `syncSource()`, and each calls `searchVersion.value++`. This causes `searchVersion` to increment 4 times in rapid succession, scheduling redundant re-renders of the search results view during the critical first-input frame.
   - **Fix**: Batch the initial index synchronization inside `start()` so `searchVersion.value` increments at most once during startup:
     ```ts
     batch(() => {
       start();
     });
     ```

---

## (7) Top 10 Concrete Changes (Ranked by Priority)

1. **Fix Fuzzysort Workspace Threshold (`src/ui/search.ts:125`)**:
   Change `r.score >= 0.3` to `r.score > -1000` to restore workspace search.
2. **Include Active Unsorted Workspace in Read Model (`src/ui/store.ts:86-90`)**:
   Prepend `store.metas.value[active]` to `workspaces.value` when `active` is an Unsorted workspace.
3. **Fix Window Removal and Focus Tracking (`src/ui/store.ts:276-288`)**:
   Pass `windowId` into `selectWindow()` on `onFocusChanged`, and clear/re-resolve `store.windowId` when the active window is removed in `onRemoved`.
4. **Move `uiError` Display to Top Level (`src/entrypoints/popup/App.tsx:46`, `src/entrypoints/sidepanel/App.tsx:47`)**:
   Extract error banner from `WorkspacesSection.tsx` so RPC failures are visible during search mode.
5. **Disable Delete Action on Unsorted Workspaces (`src/ui/components/WorkspaceRow.tsx:48, 120-127`)**:
   Prevent `Delete` shortcut and remove the "Delete" menu item when `meta.kind === "unsorted"`.
6. **Eliminate Initial Storage Get/OnChanged Race (`src/ui/hooks/useStorageKey.ts:45-50`)**:
   Add an `initialLoaded` guard in `useStorageKey` and `Quarantine.tsx` to prevent stale `get()` responses from overwriting newer `onChanged` events.
7. **Fix Dangling `aria-controls` on Search Combobox (`src/ui/components/SearchBox.tsx:34`)**:
   Only set `aria-controls` when the search query is non-empty and `SearchResults` is rendered.
8. **Fix ARIA Direct-Child Violations in Search Results (`src/ui/sections/SearchResults.tsx:19-21`)**:
   Remove `role="listbox"` from the empty-state container; assign `role="status"`.
9. **Memoize `liveTabCount` and `duplicateCount` (`src/ui/store.ts:64`, `src/ui/sections/WindowActions.tsx:14`)**:
   Convert unmemoized array filtering into computed signals to prevent re-render cascades on tab events.
10. **Prevent Flash of Empty State on Popup Open (`src/entrypoints/popup/main.tsx:9-10`, `src/ui/sections/WorkspacesSection.tsx:55`)**:
    Condition `EmptyState` rendering on `store.ready.value === true` to eliminate layout shift when initial storage reads exceed 150 ms.
