# Final Pre-Release Review: Tabitat v1.0.0

---

## (1) Verdict

**NOT YET RELEASABLE as v1.0.0.** Manual QA alone cannot clear the release. 

Release is blocked by four hard gates:
1. **Release workflow failure**: [`package.json:4`](file:///Users/sajid/Developer/personal/tabitat/package.json#L4) is at `0.0.1`. Tagging `v1.0.0` will immediately fail the version assertion in [`.github/workflows/release.yml:29`](file:///Users/sajid/Developer/personal/tabitat/.github/workflows/release.yml#L29), aborting the build.
2. **Store policy violation / manifest mismatch**: [`PRIVACY.md:75`](file:///Users/sajid/Developer/personal/tabitat/PRIVACY.md#L75) claims the `sessions` permission is declared in the manifest, but it was removed from [`wxt.config.ts:39-49`](file:///Users/sajid/Developer/personal/tabitat/wxt.config.ts#L39-L49). A Web Store reviewer will reject or question this discrepancy.
3. **Broken advertised keyboard controls**: [`src/ui/components/WorkspaceRow.tsx:52-67`](file:///Users/sajid/Developer/personal/tabitat/src/ui/components/WorkspaceRow.tsx#L52-L67) advertises digit shortcuts `1..9` via `aria-keyshortcuts` and UI badges, but completely omits digit handling in `onKeyDown`.
4. **Unfilled release placeholders**: `<repo-url>`, `<maintainer email>`, and `<chrome-web-store-url>` remain in `README.md`, `PRIVACY.md`, `COMPATIBILITY.md`, `SECURITY.md`, and `CHANGELOG.md`.

Once these blockers are addressed alongside manual QA (Q1–Q15), v1.0.0 can ship.

---

## (2) Correctness Bugs in Phase 5 Code

### 1. `WorkspaceRow` ignores advertised `1..9` shortcut keys
* **Location**: [`src/ui/components/WorkspaceRow.tsx:52-67`](file:///Users/sajid/Developer/personal/tabitat/src/ui/components/WorkspaceRow.tsx#L52-L67)
* **Scenario**: The row advertises `p.shortcut` via `aria-keyshortcuts` (line 97) and `<Kbd>` (line 132), and CHANGELOG claims row keys `1 to 9`. When focused on a workspace row and pressing digit `1` (or matching `p.shortcut`), the key falls through to `p.item.onKeyDown(e)` which ignores non-navigation keys. The shortcut never activates.
* **Severity**: High
* **Fix**: In `onKeyDown`, add:
  ```tsx
  else if (plain && p.shortcut !== undefined && k === String(p.shortcut)) open();
  ```

### 2. Missing `returnFocus` on Workspace Menu causes focus loss
* **Location**: [`src/ui/components/WorkspaceRow.tsx:135-176`](file:///Users/sajid/Developer/personal/tabitat/src/ui/components/WorkspaceRow.tsx#L135-L176)
* **Scenario**: Unlike `RowActions.tsx:94` which provides `returnFocus={() => cell.current?.focus()}`, `WorkspaceRow` does not pass `returnFocus` to `<Menu>`. When a user closes the workspace menu with Escape or selects an action, focus is dropped to `document.body`, disrupting keyboard navigation.
* **Severity**: Medium
* **Fix**: Add a ref to the primary cell in `WorkspaceRow` and pass `returnFocus={() => cellRef.current?.focus()}` to `<Menu>`.

### 3. Case-sensitive shortcut keys broken by Caps Lock
* **Location**: [`src/ui/components/TabRow.tsx:52`](file:///Users/sajid/Developer/personal/tabitat/src/ui/components/TabRow.tsx#L52)
* **Scenario**: Actions define `key: "p"` (park) and `key: "z"` (suspend). `keyed` is resolved via `actions.find((a) => a.key === k)`. If a user has Caps Lock enabled, `e.key` produces `"P"` or `"Z"`, failing the strict match even though Shift is not pressed.
* **Severity**: Low
* **Fix**: Change to:
  ```tsx
  const keyed = plain && !e.shiftKey ? actions.find((a) => a.key?.toLowerCase() === k.toLowerCase()) : undefined;
  ```

### 4. `TabGroupHeader` invalid `aria-rowindex` fallback
* **Location**: [`src/ui/sections/TabsSection.tsx:169`](file:///Users/sajid/Developer/personal/tabitat/src/ui/sections/TabsSection.tsx#L169)
* **Scenario**: `rowIndex={(headerPos.get(run.groupId) ?? -1) + 1}` defaults to `0` if `headerPos` lookup returns undefined. ARIA requires `aria-rowindex >= 1`.
* **Severity**: Low
* **Fix**: Ensure fallback is `1` or guard before rendering: `(headerPos.get(run.groupId) ?? 0) + 1`.

---

## (3) Accessibility: APG Conformance of the Grid

### Grid Pattern Analysis (WAI-ARIA APG)

1. **Grid Roles & Structural Conformance**:
   * **Grid Container**: `role="grid"` on [`TabsSection.tsx:152`](file:///Users/sajid/Developer/personal/tabitat/src/ui/sections/TabsSection.tsx#L152), [`WorkspacesSection.tsx:47`](file:///Users/sajid/Developer/personal/tabitat/src/ui/sections/WorkspacesSection.tsx#L47), [`LinksSection.tsx:148`](file:///Users/sajid/Developer/personal/tabitat/src/ui/sections/LinksSection.tsx#L148), [`ClosedSection.tsx:37`](file:///Users/sajid/Developer/personal/tabitat/src/ui/sections/ClosedSection.tsx#L37).
   * **Direct children in `TabsSection.tsx:153-179`**: Ungrouped rows are direct children of `role="grid"`, whereas grouped tabs are wrapped in `<div role="rowgroup">`. Mixing direct `role="row"` and `role="rowgroup"` siblings violates ARIA 1.2 structure. Either wrap ungrouped rows in an anonymous `role="rowgroup"` or eliminate `rowgroup`.
   * **Missing `aria-colspan` on `TabGroupHeader.tsx:29`**: A tab group header is a `role="row"` with a single `role="gridcell"`, but the grid has 2 columns (primary content + actions). Screen readers expect `aria-colspan="2"` on this cell.
   * **Missing Column Metadata**: None of the grids declare `aria-colcount="2"`, and individual cells lack `aria-colindex`.

2. **Roving Tabindex and Focus Targets**:
   * **Focus Target Inconsistency**: In `TabRow.tsx:89` and `WorkspaceRow.tsx:98`, `tabIndex` lives on the `role="gridcell"`. In `TabGroupHeader.tsx:36`, `tabIndex` is placed on the inner `<button>`. Focus should consistently target either the cell or its primary interactive control.
   * **`ActionsCell` Roving State**: `ActionsCell` ([`GridCells.tsx:48`](file:///Users/sajid/Developer/personal/tabitat/src/ui/components/GridCells.tsx#L48)) has no `tabIndex`, and its buttons are `tabIndex={-1}`. When focus moves into `ActionsCell`, the primary cell still holds `tabIndex="0"`. If focus leaves and returns, focus lands on the primary cell rather than the last focused button.

3. **Keyboard Navigation & APG Key Behaviors**:
   * **Column Jump on Vertical Navigation**: In [`GridCells.tsx:41`](file:///Users/sajid/Developer/personal/tabitat/src/ui/components/GridCells.tsx#L41), when focus is on a button inside `ActionsCell` (column 2) and the user presses `ArrowDown` or `ArrowUp`, `p.item.nav(e.key)` focuses `els.current[nextRow]`, which is the primary cell (column 1). Focus abruptly jumps columns from actions back to the row body.
   * **`Home` / `End` APG Deviation**: In APG grid, `Home`/`End` must move focus to the first/last cell of the *current row*; `Ctrl+Home`/`Ctrl+End` move to the start/end of the grid. In [`useRoving.ts:43-46`](file:///Users/sajid/Developer/personal/tabitat/src/ui/hooks/useRoving.ts#L43-L46), `Home`/`End` unconditionally jump to the first/last row of the entire grid.
   * **Group Header Disclosure Keys**: In [`TabGroupHeader.tsx:39`](file:///Users/sajid/Developer/personal/tabitat/src/ui/components/TabGroupHeader.tsx#L39), `ArrowRight` does not expand a collapsed group, and `ArrowLeft` does not collapse it. APG requires Left/Right arrow control on disclosure rows.

### What axe Cannot Catch
* Roving tabindex desynchronization (e.g., active focus on a `-1` button while inactive primary cell has `0`).
* Arrow key navigation bugs (jumping columns on vertical moves; `Home`/`End` moving across rows).
* Group header Left/Right expand/collapse behavior.
* Focus restoration on menu dismissal (`WorkspaceRow`).
* Contrast of dynamic focus rings over custom wallpaper or dynamic swatches.

### Concrete Fixes
1. Add `aria-colspan="2"` to [`TabGroupHeader.tsx:29`](file:///Users/sajid/Developer/personal/tabitat/src/ui/components/TabGroupHeader.tsx#L29):
   ```tsx
   <div role="gridcell" aria-colspan="2">
   ```
2. In [`TabsSection.tsx:153-179`](file:///Users/sajid/Developer/personal/tabitat/src/ui/sections/TabsSection.tsx#L153-L179), wrap ungrouped tab runs in `<div role="rowgroup">` or remove `role="rowgroup"` from grouped runs.
3. In [`TabGroupHeader.tsx:33-40`](file:///Users/sajid/Developer/personal/tabitat/src/ui/components/TabGroupHeader.tsx#L33-L40), handle `ArrowRight` (when collapsed, expand) and `ArrowLeft` (when expanded, collapse).
4. In [`GridCells.tsx:41`](file:///Users/sajid/Developer/personal/tabitat/src/ui/components/GridCells.tsx#L41), inspect whether the adjacent row has an actions cell, and if so, focus its matching action button instead of dropping back to column 1.

---

## (4) Privacy and Store Compliance

### Manifest vs. PRIVACY.md and store/README.md

| Permission / Field | `wxt.config.ts` | `PRIVACY.md` | `store/README.md` | Compliance Status |
|---|---|---|---|---|
| `tabs` | Declared (line 40) | Listed (line 69) | Listed (line 70) | **MATCH** |
| `tabGroups` | Declared (line 41) | Listed (line 70) | Listed (line 71) | **MATCH** |
| `storage` | Declared (line 42) | Listed (line 71) | Listed (line 72) | **MATCH** |
| `unlimitedStorage` | Declared (line 43) | Listed (line 72) | Listed (line 73) | **MATCH** |
| `sidePanel` | Declared (line 44) | Listed (line 73) | Listed (line 74) | **MATCH** |
| `alarms` | Declared (line 45) | Listed (line 74) | Listed (line 75) | **MATCH** |
| `favicon` | Declared (line 46) | Listed (line 76) | Listed (line 76) | **MATCH** |
| `notifications` | Declared (line 47) | Listed (line 77) | Listed (line 77) | **MATCH** |
| `search` | Declared (line 48) | Listed (line 78) | Listed (line 78) | **MATCH** |
| `bookmarks` (optional) | Declared (line 50) | Listed (line 79) | Listed (line 79) | **MATCH** |
| `sessions` | **NOT DECLARED** | **Listed (line 75)** ("Declared in the manifest") | Not Listed | **MISMATCH (BLOCKER)** |
| CSP (`connect-src 'none'`) | Enforced (line 8) | Accurately stated (line 45) | Accurately stated (line 82) | **MATCH** |

### Permission Justifications a Reviewer Would Question
1. **`search`**: Web Store automated filters aggressively scrutinize extensions requesting `search` for search-hijacking compliance. The justification ("runs a web search with default engine only when user submits") is clear, but reviewers may ask why a workspace manager needs search.
2. **`unlimitedStorage`**: Reviewers routinely question `unlimitedStorage`. Justification ("snapshots and workspaces exceed 5MB quota") is sound, but must be defended against quota-leak suspicions.

### Single-Purpose Statement Compliance
* `store/README.md:62-65` states:
  > "Tabitat organizes the browser's tabs into workspaces that can be saved, switched and searched, with a side panel and dashboard for working with those workspaces."
* **Risk**: The extension bundles a tab manager, todo list, markdown notes app, and pomodoro timer. Google's Single Purpose policy forbids multi-purpose toolkits. The single-purpose statement omits todos, notes, and pomodoro, while the summary (`store/README.md:24`) prominently advertises them. Reviewers may challenge this as a multi-purpose utility suite.
* **Remedy**: Frame todos, notes, and pomodoro as metadata/focus utilities strictly tied to the active workspace.

### Missing Listing Items
1. **1280×800 Popup / Side Panel Screenshots**: `store/README.md:58-60` notes that popup and sidepanel screenshots are 2× crops not accepted by the Web Store. Only dashboard and options screenshots currently meet store dimensions. Composite 1280×800 screenshots showing popup and side panel in context are needed.
2. **Trader Status & Contact**: EU Digital Services Act (DSA) declarations (trader vs. non-trader) and physical address/email are required during store submission.

---

## (5) Documentation Accuracy

1. **Unimplemented Shortcuts in Documentation**:
   * [`CHANGELOG.md:37`](file:///Users/sajid/Developer/personal/tabitat/CHANGELOG.md#L37) claims:
     > "Row keys: Enter or Space, F2 rename, Delete, p park, z suspend; /, 1 to 9, n in the lists."
   * In reality:
     * `1 to 9`: Unhandled in `WorkspaceRow.tsx`.
     * `/`: No keydown handler in any list or row component (only combobox input search).
     * `n`: `<button aria-keyshortcuts="n">` exists in `WorkspacesSection.tsx:33`, but there is no document or section-level keydown listener to trigger it.
2. **Unresolved Placeholders**:
   * `<repo-url>`: Found in [`README.md:59`](file:///Users/sajid/Developer/personal/tabitat/README.md#L59), [`COMPATIBILITY.md:55`](file:///Users/sajid/Developer/personal/tabitat/COMPATIBILITY.md#L55), [`SECURITY.md:7`](file:///Users/sajid/Developer/personal/tabitat/SECURITY.md#L7), [`CHANGELOG.md:94-95`](file:///Users/sajid/Developer/personal/tabitat/CHANGELOG.md#L94-L95).
   * `<maintainer email>`: Found in [`PRIVACY.md:102`](file:///Users/sajid/Developer/personal/tabitat/PRIVACY.md#L102), [`SECURITY.md:8`](file:///Users/sajid/Developer/personal/tabitat/SECURITY.md#L8).
   * `<chrome-web-store-url>`: Found in [`README.md:56`](file:///Users/sajid/Developer/personal/tabitat/README.md#L56).
   * `REPO_URL` in [`wxt.config.ts:3`](file:///Users/sajid/Developer/personal/tabitat/wxt.config.ts#L3) imports placeholder from `src/ui/options/about`.
3. **Onboarding Text vs. Behavior**:
   * [`src/entrypoints/onboarding/App.tsx:23`](file:///Users/sajid/Developer/personal/tabitat/src/entrypoints/onboarding/App.tsx#L23) hardcodes `SHORTCUTS_URL = "chrome://extensions/shortcuts"`. On Edge or other Chromium forks, this does not direct to the browser's native shortcuts manager despite `COMPATIBILITY.md` claiming compatibility.
   * Onboarding `leave()` ([`App.tsx:158-161`](file:///Users/sajid/Developer/personal/tabitat/src/entrypoints/onboarding/App.tsx#L158-L161)) unconditionally falls back to redirecting the tab to `/dashboard.html` if `window.close()` fails, even in the default (non-newtab) flavor where dashboard is not the expected destination.

---

## (6) Release Engineering

1. **Tag Parsing & Version Consistency**:
   * [`.github/workflows/release.yml:25-33`](file:///Users/sajid/Developer/personal/tabitat/.github/workflows/release.yml#L25-L33) extracts `VERSION="${GITHUB_REF_NAME#v}"` and asserts `$VERSION == $(node -p "require('./package.json').version")`.
   * **Failure Point**: [`package.json:4`](file:///Users/sajid/Developer/personal/tabitat/package.json#L4) is currently `"version": "0.0.1"`. Pushing tag `v1.0.0` will fail this check and exit with error.
2. **Zip Artifact Generation**:
   * `release.yml:45-52` copies `.output/tabitat-${VERSION}-chrome.zip` to `release-assets/tabitat-${VERSION}.zip` and `.output-newtab/tabitat-${VERSION}-chrome.zip` to `release-assets/tabitat-newtab-${VERSION}.zip`. This correctly renames and packages both flavors for `action-gh-release`.
3. **Changelog Extraction**:
   * `release.yml:57-71` uses `awk` matching `index($0, "## [" v "]") == 1` and stops on `## [` or link definitions `^\[[^]]+\]: `.
   * Tested against [`CHANGELOG.md:9-92`](file:///Users/sajid/Developer/personal/tabitat/CHANGELOG.md#L9-L92): for `v="1.0.0"`, it correctly extracts exactly lines 9–92 (Added, Known limitations) and stops at line 94 `[Unreleased]: ...`.
4. **Permissions**:
   * `release.yml:10-11` specifies `permissions: contents: write`, which is required and sufficient for `actions/checkout` and `softprops/action-gh-release@v2`.
5. **CI Workflow Verification**:
   * [`.github/workflows/ci.yml:18-24`](file:///Users/sajid/Developer/personal/tabitat/.github/workflows/ci.yml#L18-L24) executes `npm run check`, builds both flavors, runs budgets on both, packages both zips, and uploads artifacts. Conforms to spec.

---

## (7) Residual Risk for 1.0

### Must Fix Before Release
1. **Version mismatch in `package.json`**: Blocks release workflow execution.
2. **Ghost `sessions` permission in `PRIVACY.md`**: Immediate store review rejection.
3. **Workspace shortcut keys (`1..9`) missing**: Broken core accessibility and documented feature.
4. **Unfilled URL and email placeholders**: Ship blocker per `docs/RELEASE.md:9-10`.
5. **Focus loss on workspace menu dismissal**: Breaks keyboard traversal in the main popup/panel.

### Acceptable Post-1.0
1. **Grid column 2 vertical navigation (ArrowDown/Up column jumping)**: Keyboard navigation is functional via primary cell roving; 2D cell navigation refinement can land in 1.0.1.
2. **Untested non-Chrome Chromium forks**: Accurately documented in `COMPATIBILITY.md`.
3. **Caps Lock shortcut sensitivity (`P` / `Z`)**: Minor convenience issue.
4. **`TabGroupHeader` Left/Right arrow expand/collapse**: Enter/Space works natively via button activation.

---

## (8) Top 10 Concrete Changes Ranked by Priority

1. **Bump package version**:
   * File: [`package.json:4`](file:///Users/sajid/Developer/personal/tabitat/package.json#L4)
   * Change: Update `"version": "0.0.1"` to `"version": "1.0.0"`.
2. **Remove `sessions` permission from PRIVACY.md**:
   * File: [`PRIVACY.md:75`](file:///Users/sajid/Developer/personal/tabitat/PRIVACY.md#L75)
   * Change: Delete the `| sessions | Declared in the manifest... |` row.
3. **Fill required release placeholders**:
   * Files: [`README.md`](file:///Users/sajid/Developer/personal/tabitat/README.md), [`PRIVACY.md`](file:///Users/sajid/Developer/personal/tabitat/PRIVACY.md), [`COMPATIBILITY.md`](file:///Users/sajid/Developer/personal/tabitat/COMPATIBILITY.md), [`SECURITY.md`](file:///Users/sajid/Developer/personal/tabitat/SECURITY.md), [`CHANGELOG.md`](file:///Users/sajid/Developer/personal/tabitat/CHANGELOG.md), [`src/ui/options/about.ts`](file:///Users/sajid/Developer/personal/tabitat/src/ui/options/about.ts)
   * Change: Replace `<repo-url>`, `<maintainer email>`, `<chrome-web-store-url>`, and set `REPO_URL`.
4. **Implement `1..9` shortcut key handling in `WorkspaceRow`**:
   * File: [`src/ui/components/WorkspaceRow.tsx:55`](file:///Users/sajid/Developer/personal/tabitat/src/ui/components/WorkspaceRow.tsx#L55)
   * Change: Add `else if (plain && p.shortcut !== undefined && k === String(p.shortcut)) open();`.
5. **Restore focus on `WorkspaceRow` menu close**:
   * File: [`src/ui/components/WorkspaceRow.tsx:135`](file:///Users/sajid/Developer/personal/tabitat/src/ui/components/WorkspaceRow.tsx#L135)
   * Change: Add ref to primary cell and pass `returnFocus={() => cellRef.current?.focus()}` to `<Menu>`.
6. **Add `aria-colspan="2"` to `TabGroupHeader` cell**:
   * File: [`src/ui/components/TabGroupHeader.tsx:29`](file:///Users/sajid/Developer/personal/tabitat/src/ui/components/TabGroupHeader.tsx#L29)
   * Change: `<div role="gridcell" aria-colspan="2">`.
7. **Fix documentation for unimplemented list shortcuts**:
   * File: [`CHANGELOG.md:37`](file:///Users/sajid/Developer/personal/tabitat/CHANGELOG.md#L37)
   * Change: Remove `/` and `n` from row keys summary, or implement section-level listeners for them.
8. **Fix vertical arrow navigation from `ActionsCell`**:
   * File: [`src/ui/components/GridCells.tsx:41`](file:///Users/sajid/Developer/personal/tabitat/src/ui/components/GridCells.tsx#L41)
   * Change: In `ActionsCell`, prevent `ArrowDown`/`ArrowUp` from collapsing focus back to the primary cell when the adjacent row has action buttons.
9. **Support case-insensitive row shortcuts**:
   * File: [`src/ui/components/TabRow.tsx:52`](file:///Users/sajid/Developer/personal/tabitat/src/ui/components/TabRow.tsx#L52)
   * Change: Match `a.key?.toLowerCase() === k.toLowerCase()` to ensure `p` and `z` function under Caps Lock.
10. **Align Single Purpose statement in `store/README.md`**:
    * File: [`store/README.md:62-65`](file:///Users/sajid/Developer/personal/tabitat/store/README.md#L62-L65)
    * Change: Explicitly describe notes, todos, and pomodoro as workspace-associated focus utilities to defend against Web Store multi-purpose rejections.
