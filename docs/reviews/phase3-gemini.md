# Tabitat Phase 3 Implementation Review Report

---

### 1. Verdict

**NOT APPROVED for tagging `phase-3`.**

While the core architecture is solid (strict adherence to serialized worker commands via ADR-003, no direct UI writes to storage, and pure domain rules in `src/core`), several blockers must be addressed before release:
1. **Bookmarks Import Mapping**: Selecting folders across distinct browser bookmark trees (e.g., Bookmarks Bar and Other Bookmarks) collapses `commonRoot` to empty, turning root folders into workspaces instead of preserving the selected subfolders.
2. **Settings Sync Specification Violation**: `theme` is specified as device-specific in `docs/PHASE3.md` §4, but `toSyncPayload` pushes it and `applyRemoteSettings` overwrites it, clobbering user themes across machines.
3. **Redundant Sync Pushes**: When pulling remote settings (on enabling sync or clicking "Sync now"), the pulled copy is immediately pushed back to `storage.sync`, wasting quota and triggering extra sync notifications.
4. **Recovery Hint Sticking**: `recovery:hint` is not cleared when a new generation with all windows matched is written.
5. **Keyboard Focus Loss on Suspend**: When a tab is suspended using `z`, Chrome replaces the tab ID (`tabs.onReplaced`), which unmounts the Preact row element and drops keyboard focus to `document.body`.
6. **Test Coverage Gaps**: Acceptance test (g) (`tabs.suspend` e2e), unit tests for `settings-sync` LWW/quota, bookmarks planner unit tests, and `@testing-library/preact` DOM tests are absent.

---

### 2. Correctness Bugs

#### Bug 2.1: Multi-root bookmarks import creates root workspaces instead of folder workspaces
- **File & Line**: [src/core/backup/bookmarks.ts#L694-L728](file:///Users/sajid/Developer/personal/tabitat/src/core/backup/bookmarks.ts#L694-L728)
- **Failure Scenario**: A user chooses "One workspace per selected folder" and selects `["Bookmarks bar", "Work"]` and `["Other bookmarks", "Reference"]`. `commonRoot` returns `[]` because the roots differ. In `bucketsPerFolder`, `folder = e.path[root.length]` evaluates to `e.path[0]` (`"Bookmarks bar"` and `"Other bookmarks"`). Instead of creating workspaces named "Work" and "Reference", Tabitat creates workspaces named "Bookmarks bar" and "Other bookmarks", aggregating unrelated folders under generic root names.
- **Severity**: High
- **Fix**: Determine the bucket name based on the selected folder node from the folder tree selection rather than `e.path[commonRoot.length]`. Pass the selected folder IDs or map each entry directly to its selected parent folder.

---

#### Bug 2.2: Settings Sync pushes remote settings back to `storage.sync` immediately after pulling
- **File & Line**: [src/background/settings-sync.ts#L1338-L1342](file:///Users/sajid/Developer/personal/tabitat/src/background/settings-sync.ts#L1338-L1342) and [src/background/settings-sync.ts#L1346-L1351](file:///Users/sajid/Developer/personal/tabitat/src/background/settings-sync.ts#L1346-L1351)
- **Failure Scenario**: When sync is toggled on (`!prev.syncSettings`), `afterUpdate` calls `pull()`. If remote is newer, `current` receives the pulled settings. Line 1341 then unconditionally calls `await this.push(current)`. Similarly, in `syncNow()`, line 1350 executes `return this.push(pulled ?? ...)` when `pulled` is non-null. The local worker writes the exact remote payload back to `storage.sync`, unnecessarily consuming Chrome's `MAX_WRITE_OPERATIONS_PER_HOUR` quota and triggering redundant `storage.onChanged` events on peer devices.
- **Severity**: Medium
- **Fix**: In `afterUpdate`, if `pull()` succeeds, skip `push()` and return `current`. In `syncNow()`, if `pulled` is non-null, return `this.status()` without pushing.

---

#### Bug 2.3: `recovery:hint` is not cleared when a new generation matches all windows
- **File & Line**: [src/background/session-guard.ts#L1890-L1898](file:///Users/sajid/Developer/personal/tabitat/src/background/session-guard.ts#L1890-L1898)
- **Failure Scenario**: Following a browser restart, an unmatched window causes `reconcileWindows` to write `recovery:hint`. If the user manually reopens the missing tabs or window and a regular snapshot is taken by `session-gen` (or on workspace switch), every window is now matched. However, `SessionGuard.write()` only clears `recovery:hint` when the generation leaves the ring (`dropped.includes(hint.generation)`). The `RecoveryBanner` continues displaying "A window from your last session was not restored" indefinitely until manually dismissed or restored.
- **Severity**: Medium
- **Fix**: In `SessionGuard.writeNow` (or `write`), check if `recovery:hint` is present. If `countUnmatchedSessionWindows` for the active live windows against the current state is 0, remove `BgKeys.recoveryHint`.

---

#### Bug 2.4: `tabs.suspend` does not declare `window:<id>` in router, bypassing queue serialization and `busy` check
- **File & Line**: [src/background/handlers.ts#L2207-L2217](file:///Users/sajid/Developer/personal/tabitat/src/background/handlers.ts#L2207-L2217) and [src/background/suspender.ts#L1528-L1530](file:///Users/sajid/Developer/personal/tabitat/src/background/suspender.ts#L1528-L1530)
- **Failure Scenario**: The command router registration for `tabs.suspend` returns `() => []` for lanes, delegating lane acquisition inside the handler via `ctx.lanes.run([Lane.window(tab.windowId)])`. When a workspace switch is currently executing on that window, the router does not reject the command as `busy`. Instead, the handler asynchronously queries `ports.tabs.get(p.tabId)` and blocks in `lanes.run`. When the switch completes, the tab may already have been closed by the switch, causing an unexpected `not_found` error instead of the specified immediate `busy` response.
- **Severity**: Medium
- **Fix**: Check `if (await this.deps.isLocked(tab.windowId)) throw new RpcError("busy", "a switch is running in this window");` prior to running inside `ctx.lanes.run`.

---

#### Bug 2.5: Subdomain toggling strips parent domain from suspension whitelist
- **File & Line**: [src/ui/tabActions.ts#L4193-L4208](file:///Users/sajid/Developer/personal/tabitat/src/ui/tabActions.ts#L4193-L4208)
- **Failure Scenario**: User has `example.com` whitelisted. When visiting `docs.example.com`, `isWhitelisted` returns true, so the tab row context menu offers "Allow suspending this site". Clicking it executes `toggleWhitelist(["example.com"], "docs.example.com")`. The helper checks `covers("example.com", "docs.example.com")` which evaluates to `true`, and filters out `"example.com"`. As a result, the parent domain `example.com` and all other subdomains (`mail.example.com`, `app.example.com`) are removed from the whitelist.
- **Severity**: Medium
- **Fix**: When removing entries in `toggleWhitelist`, only remove entries where `norm[i] === h` (exact host match). If the host was only covered by a parent domain, add an exclusion or alert the user.

---

#### Bug 2.6: Tab row `p` (park) and drag-and-drop bypass duplicate link check
- **File & Line**: [src/ui/sections/LinksSection.tsx#L5025-L5031](file:///Users/sajid/Developer/personal/tabitat/src/ui/sections/LinksSection.tsx#L5025-L5031) and [src/background/handlers.ts#L2181-L2195](file:///Users/sajid/Developer/personal/tabitat/src/background/handlers.ts#L2181-L2195)
- **Failure Scenario**: `LinkForm` explicitly blocks duplicates (`isSavedLink(workspaceId, u)` shows "Already saved"). However, dropping a tab onto the `LinksSection` drop zone calls `parkTab(tab.id, meta.id)` without checking `isSavedLink`. In `handlers.ts`, `tabs.park` unconditionally calls `addLink`, saving duplicate links to the workspace.
- **Severity**: Medium
- **Fix**: Check `isSavedLink(meta.id, tab.url)` in `LinksSection.onDrop` before dispatching `parkTab`, or check for existing normalized URLs inside the `tabs.park` worker handler.

---

### 3. Architecture & Privacy Violations

1. **Device-Specific Theme Leaked into `storage.sync`**:
   - [docs/PHASE3.md#L113](file:///Users/sajid/Developer/personal/tabitat/docs/PHASE3.md#L113) specifies: "`theme` and `dashboard.wallpaper` with `kind: "image"` are device-specific: exclude `dashboard.wallpaper` when `kind === "image"` from the pushed object (keep the local one on pull)."
   - In [src/core/sync/settings.ts#L570-L578](file:///Users/sajid/Developer/personal/tabitat/src/core/sync/settings.ts#L570-L578), `toSyncPayload` only strips `rev` and image wallpaper. `theme` is included in the sync payload.
   - In [src/core/sync/settings.ts#L604-L618](file:///Users/sajid/Developer/personal/tabitat/src/core/sync/settings.ts#L604-L618), `applyRemoteSettings` does `...structuredClone(remote)` and does not restore `local.theme`.
   - **Privacy & Architecture Impact**: Device-specific theme preferences (e.g. desktop dark mode vs. laptop light mode) are overwritten.
   - **Fix**: Keep local theme during sync pull: `next.theme = local.theme;` in `applyRemoteSettings`.

2. **Unvalidated Whitelist Growth in `toggleSiteWhitelist`**:
   - [src/ui/tabActions.ts#L4220-L4229](file:///Users/sajid/Developer/personal/tabitat/src/ui/tabActions.ts#L4220-L4229) updates `suspend.whitelist` via `settings.update` without validating against `LIMITS.whitelistHosts` (200).
   - While `WhitelistEditor.tsx` prevents typing >200 hosts, toggling sites from the tab row menu can push the whitelist beyond the 200 limit.

---

### 4. Accessibility Issues

1. **Keyboard Focus Destroyed on `tabs.suspend` (`z` key)**:
   - **File & Line**: [src/ui/components/TabRow.tsx#L4595-L4612](file:///Users/sajid/Developer/personal/tabitat/src/ui/components/TabRow.tsx#L4595-L4612) and [src/ui/sections/TabsSection.tsx#L4824-L4848](file:///Users/sajid/Developer/personal/tabitat/src/ui/sections/TabsSection.tsx#L4824-L4848)
   - **Issue**: Suspending a tab causes Chrome to replace the tab ID. `TabsSection` renders `TabRow` with `key={tab.id}`. The currently focused row is unmounted and replaced with a new element, throwing focus to `document.body`.
   - **Fix**: Preserve focus on the item at `tabPos` after replacement in `useRoving` or avoid changing the key on replacement.

2. **ConfirmAction Dialog Drops Focus and Lacks Escape Key Listener**:
   - **File & Line**: [src/ui/options/actions.tsx#L5500-L5537](file:///Users/sajid/Developer/personal/tabitat/src/ui/options/actions.tsx#L5500-L5537)
   - **Issue**: Clicking "Empty trash" or "Reset all settings" unmounts the trigger button and renders `<div role="alertdialog">`. Focus is lost to `document.body`. Furthermore, `role="alertdialog"` does not listen for `Escape`, preventing keyboard users from canceling.
   - **Fix**: Auto-focus the cancel button on mount and add `onKeyDown={(e) => e.key === "Escape" && setAsking(false)}`.

3. **Missing `aria-live` and Context for Duplicates Filter Toggle**:
   - **File & Line**: [src/ui/sections/TabsSection.tsx#L4853-L4863](file:///Users/sajid/Developer/personal/tabitat/src/ui/sections/TabsSection.tsx#L4853-L4863)
   - **Issue**: Activating the "Duplicates (N)" filter button (`aria-pressed`) changes the tab list to show only duplicate groups. However, the section header count (`tabs.length`) continues to announce the total number of tabs in the window, and no live region announces the filtered count.
   - **Fix**: Update the `SectionHeader` count to reflect the displayed tab count when `filtering` is true, or add an `aria-live="polite"` status message announcing the filtered results.

4. **Missing Tooltip and Accessibility Description on Duplicate Chips**:
   - **File & Line**: [src/ui/components/TabRow.tsx#L4618](file:///Users/sajid/Developer/personal/tabitat/src/ui/components/TabRow.tsx#L4618)
   - **Issue**: `<span class={`${s.tag} ${s.chip}`}>{p.chip}</span>` does not set a `title` attribute or an accessible description, unlike `pinned` and `suspended` tags which provide `title` and `.sr-only` text.
   - **Fix**: Add `title={p.chip}` and `aria-label={p.chip}` to the chip `<span>`.

5. **FolderTree Checkbox Semantics**:
   - **File & Line**: [src/ui/options/FolderTree.tsx#L6240-L6308](file:///Users/sajid/Developer/personal/tabitat/src/ui/options/FolderTree.tsx#L6240-L6308)
   - **Issue**: Rendered as nested `<ul>`/`<li>` tags with expansion buttons and checkboxes instead of ARIA tree semantics (`role="tree"`, `role="treeitem"`, `role="group"`).
   - **Fix**: Add appropriate ARIA tree roles and keyboard arrow navigation (Up/Down to navigate, Right/Left to expand/collapse).

---

### 5. UX Gaps against docs/PHASE3.md

1. **Untranslated Warning Codes in Bookmarks Section**:
   - [docs/PHASE3.md#L172-L173](file:///Users/sajid/Developer/personal/tabitat/docs/PHASE3.md#L172-L173) specifies a "result line with counts and warnings".
   - [src/ui/options/BookmarksSection.tsx#L5970-L5976](file:///Users/sajid/Developer/personal/tabitat/src/ui/options/BookmarksSection.tsx#L5970-L5976) renders raw machine strings: `{warnings.map((w) => (<li key={w}>{w}</li>))}`. Users see `duplicates:2` or `unsupported:1` instead of human-readable translated messages.
2. **Generic Repository Link in About Section**:
   - [src/ui/options/AboutSection.tsx#L5454](file:///Users/sajid/Developer/personal/tabitat/src/ui/options/AboutSection.tsx#L5454) hardcodes `const REPO_URL = "https://github.com/";` instead of pointing to the actual Tabitat repository.
3. **No "Allow suspending this site" Tooltip/Feedback when Whitelist is Full**:
   - Toggling the site whitelist when at `LIMITS.whitelistHosts` silently fails or produces an unhandled error rather than presenting a descriptive toast.

---

### 6. Performance Concerns

1. **Synchronous URL Construction inside Render in `WhitelistEditor`**:
   - [src/ui/options/whitelist.ts#L7106-L7115](file:///Users/sajid/Developer/personal/tabitat/src/ui/options/whitelist.ts#L7106-L7115) parses each line with `new URL("http://" + entry)`.
   - In [src/ui/options/WhitelistEditor.tsx#L7160](file:///Users/sajid/Developer/personal/tabitat/src/ui/options/WhitelistEditor.tsx#L7160), `useMemo(() => parseWhitelist(text), [text])` runs on every keystroke in a textarea containing up to 200 lines. Spawning 200 `try { new URL(...) } catch` calls per character typed causes noticeable input lag.
   - **Fix**: Pre-validate host strings with a lightweight regex (`/^[a-z0-9.-]+$/i`) before falling back to `new URL()`.
2. **Duplicate Search Index Sync Triggers**:
   - In [src/ui/search.ts#L4382-L4453](file:///Users/sajid/Developer/personal/tabitat/src/ui/search.ts#L4382-L4453), five separate effects subscribe to stores. While batching handles the initial run, subsequent tab updates (audible, status loading) trigger full array diffing in `syncSource`. Consider throttling `tabs` effect runs during rapid navigation.

---

### 7. Test Gaps

1. **Missing Acceptance Tests from `docs/PHASE3.md` §10**:
   - **E2E (g)**: `tabs.suspend` on a seeded background tab marks it discarded and the row shows the sleep glyph. (Missing from [tests/e2e/options.spec.ts](file:///Users/sajid/Developer/personal/tabitat/tests/e2e/options.spec.ts) and no other spec exists).
   - **E2E (h)**: Bookmarks import into quick links with verified item ordering and limits.
2. **Missing Unit Tests**:
   - `settings-sync`: Unit tests for last-write-wins comparison (`isRemoteNewer`), size guard rejection (`too_large`), and ensuring no bounce loops occur between two devices.
   - `import.bookmarks`: Unit tests verifying URL scheme filtering (`javascript:`, `data:` rejected), deduplication within target, enforcement of `LIMITS.importWorkspaces` (50) and `LIMITS.linksPerWorkspace` (200).
   - `tabs.suspend`: Unit test covering discard eligibility rules (`eligibleForDiscard`).
   - `reconciler`: Unit test covering `recovery:hint` creation on unmatched windows and removal on full match.
3. **Missing Component DOM Tests (`*.dom.test.tsx`)**:
   - As outlined in §8, tests using `happy-dom` and `@testing-library/preact` for `TabRow` keys (`p`, `z`, context menu), `useRoving` focus recovery, `WhitelistEditor`, and `FolderTree` are absent.

---

### 8. Top 10 Concrete Changes Ranked by Priority

| Rank | Area | File:Line | Issue & Required Change |
|---|---|---|---|
| **1** | Bookmarks | [src/core/backup/bookmarks.ts:712-728](file:///Users/sajid/Developer/personal/tabitat/src/core/backup/bookmarks.ts#L712-L728) | **Fix multi-root workspace mapping**: Map bucket names to the selected folder node name rather than slicing by `commonRoot.length`. |
| **2** | Sessions | [src/background/session-guard.ts:1890-1898](file:///Users/sajid/Developer/personal/tabitat/src/background/session-guard.ts#L1890-L1898) | **Clear `recovery:hint` when all windows match**: In `SessionGuard.write`, clear `recovery:hint` when a new generation accounts for all session windows. |
| **3** | Sync | [src/core/sync/settings.ts:604-618](file:///Users/sajid/Developer/personal/tabitat/src/core/sync/settings.ts#L604-L618) | **Preserve local `theme` on sync pull**: Honor §4 device-specific theme rule by preserving `local.theme` in `applyRemoteSettings`. |
| **4** | Sync | [src/background/settings-sync.ts:1338-1351](file:///Users/sajid/Developer/personal/tabitat/src/background/settings-sync.ts#L1338-L1351) | **Do not re-push pulled settings**: Prevent calling `this.push()` when `pull()` has just applied remote settings in `afterUpdate` and `syncNow`. |
| **5** | Accessibility | [src/ui/sections/TabsSection.tsx:4824-4848](file:///Users/sajid/Developer/personal/tabitat/src/ui/sections/TabsSection.tsx#L4824-L4848) | **Retain focus after tab suspension**: Prevent losing roving focus to `document.body` when a tab row ID changes due to `tabs.onReplaced`. |
| **6** | Suspension | [src/ui/tabActions.ts:4206-4208](file:///Users/sajid/Developer/personal/tabitat/src/ui/tabActions.ts#L4206-L4208) | **Fix whitelist domain removal**: Match exact host in `toggleWhitelist` removal so toggling a subdomain does not delete parent domains. |
| **7** | Bookmarks | [src/ui/options/BookmarksSection.tsx:5970-5976](file:///Users/sajid/Developer/personal/tabitat/src/ui/options/BookmarksSection.tsx#L5970-L5976) | **Translate import warnings**: Translate `code:count` warning strings into user-friendly messages via `t()` instead of raw codes. |
| **8** | Tabs / DnD | [src/ui/sections/LinksSection.tsx:5025-5031](file:///Users/sajid/Developer/personal/tabitat/src/ui/sections/LinksSection.tsx#L5025-L5031) | **Deduplicate drag-to-park**: Check `isSavedLink` in `LinksSection.onDrop` and `tabs.park` to prevent duplicate saved links. |
| **9** | Suspension | [src/background/handlers.ts:2207-2217](file:///Users/sajid/Developer/personal/tabitat/src/background/handlers.ts#L2207-L2217) | **Eager `busy` check for `tabs.suspend`**: Reject immediately with `RpcError("busy")` if the tab's window is locked by an ongoing switch. |
| **10** | Tests | [tests/e2e/options.spec.ts:7225](file:///Users/sajid/Developer/personal/tabitat/tests/e2e/options.spec.ts#L7225) | **Add missing acceptance tests**: Implement e2e test (g) (`tabs.suspend` flow) and unit tests for `settings-sync` LWW and `planBookmarkImport`. |
