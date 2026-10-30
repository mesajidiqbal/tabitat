# Architecture Review: Tabitat (v0 Draft)

---

### (1) Verdict in 3 lines

Tabitat presents an exceptionally clean, privacy-focused vision with a strong CQRS-lite architectural separation and modern tooling. 
However, the design contains fatal Manifest V3 assumptions—notably relying on `chrome.alarms` for sub-minute debouncing, attempting impossible tab discards on newly created tabs, and storing critical window-state in ephemeral session storage.
With targeted refactoring of the tab lifecycle engine, storage schema, and phase ordering, this will be an elite, production-grade tab management extension.

---

### (2) Critical Flaws

#### 1. Debouncing Tab Snapshots via `chrome.alarms` Will Fail or Delay Auto-Save by 30+ Seconds
* **Location:** [§5.2](file:///Users/sajid/Developer/personal/tabitat/docs/ARCHITECTURE.md#L189-L191), [§5.4](file:///Users/sajid/Developer/personal/tabitat/docs/ARCHITECTURE.md#L210-L218)
* **Explanation:** In Chrome Manifest V3, `chrome.alarms` enforces a minimum granularity of 30 seconds (Chrome 120+) or 60 seconds (older releases). Calling `chrome.alarms.create` with `when: Date.now() + 1500` will be clamped by Chromium to at least 30 seconds. A 30-second auto-save debounce means that any tab closed, reordered, or opened within 30 seconds before a crash or window closure will be permanently lost.
* **The Fix:** Handle short debounces (1–2 s) using native in-memory `setTimeout` inside the Service Worker while it is active. To prevent data loss when Chrome idles the worker or when the user abruptly closes a window, hook `chrome.windows.onRemoved` and `chrome.tabs.onRemoved` to trigger an **immediate, synchronous flush** of pending dirty windows to `storage.local`.

#### 2. Immediate `chrome.tabs.discard()` on Newly Created Tabs Rejects and Causes Resource Spikes
* **Location:** [§5.3 step 4](file:///Users/sajid/Developer/personal/tabitat/docs/ARCHITECTURE.md#L198-L202)
* **Explanation:** Chromium's `chrome.tabs.discard(tabId)` API rejects with an uncatchable/runtime error if executed on a tab that has not committed its initial navigation frame (`Cannot discard a tab that is not completely loaded`). When restoring 30–50 tabs, calling `chrome.tabs.create({ url, active: false })` followed immediately by `tabs.discard()` will fail across the board. If the engine falls back to loading the destination URL, Chrome spins up dozens of network requests and renderer processes concurrently, crashing the 500 ms performance budget and freezing the browser.
* **The Fix:** Do not create tabs pointing to target URLs expecting to immediately discard them. For lazy loading, create tabs pointing to the internal placeholder: `chrome.runtime.getURL('suspended.html?url=' + encodeURIComponent(tab.url) + '&title=' + encodeURIComponent(tab.title))`. The placeholder renders instantly with zero remote network requests, uses `chrome://favicon/`, and navigates to the real destination only when the tab is activated or focused.

#### 3. Storing Window-to-Workspace Mappings Exclusively in `storage.session` Guarantees Data Loss on Restart
* **Location:** [§5.3 step 1](file:///Users/sajid/Developer/personal/tabitat/docs/ARCHITECTURE.md#L194), [§5.4](file:///Users/sajid/Developer/personal/tabitat/docs/ARCHITECTURE.md#L216-L218), [§6](file:///Users/sajid/Developer/personal/tabitat/docs/ARCHITECTURE.md#L277-L284)
* **Explanation:** `chrome.storage.session` is wiped on browser restart. When Chrome relaunches (after an update, restart, or crash), `rt:windows` is empty. Under §5.4, any window without an active workspace in `storage.session` is classified as "Unsorted." Consequently, upon browser restart, every existing window is detached from its assigned workspace and dumped into an unnamed "Unsorted" workspace, destroying the user's workspace structure.
* **The Fix:** Persist window-workspace assignments in `chrome.storage.local`. Furthermore, because Chrome assigns new, non-deterministic integer `windowId`s upon browser relaunch, implement a window reconciliation routine on `runtime.onStartup` that matches restored windows against known workspace tab signatures or prompts the user to re-link windows.

#### 4. Read-Modify-Write Race Conditions in "CQRS-Lite" Data Writes
* **Location:** [§5.1](file:///Users/sajid/Developer/personal/tabitat/docs/ARCHITECTURE.md#L176-L180), [§6](file:///Users/sajid/Developer/personal/tabitat/docs/ARCHITECTURE.md#L245)
* **Explanation:** In §6, a single key `workspace:<id>` holds both the `tabs` snapshot (frequently updated by `TabTracker` in the background) and metadata like `name`, `color`, and `resources` (edited directly by UI surfaces in §5.1). `chrome.storage.local` has no transaction locks or atomic compare-and-swap (CAS). If the UI updates a workspace name while the background worker flushes a tab snapshot, one operation will overwrite the other. A "small in-storage version counter" detects the collision but cannot prevent data loss or silent mutation drops.
* **The Fix:** Segregate storage keys by churn rate and writer ownership:
  1. `workspace:meta:<id>`: Written only when updating metadata/resources.
  2. `workspace:tabs:<id>`: Written only by the background snapshot engine.
  Alternatively, eliminate direct UI writes and route all mutations through the background Service Worker command router, serializing writes through a single queue.

#### 5. `TabTracker` Event Storms During Workspace Switching
* **Location:** [§5.3](file:///Users/sajid/Developer/personal/tabitat/docs/ARCHITECTURE.md#L192-L206), [§5.4](file:///Users/sajid/Developer/personal/tabitat/docs/ARCHITECTURE.md#L210-L218)
* **Explanation:** A workspace switch closes outgoing tabs and creates incoming tabs in rapid succession. Each action fires `tabs.onCreated`, `tabs.onRemoved`, and `tabs.onActivated`. Without an explicit suppression mechanism, `TabTracker` receives these events, flags the window as dirty, and triggers debounced snapshots while the window is in a transitional, half-opened state. This can snapshot an incomplete tab set and corrupt the stored workspace.
* **The Fix:** Add a switching mutex in the Service Worker: maintain an active switch registry `switchingWindows: Set<number>`. While `windowId` is switching, `TabTracker` must drop all incoming tab events for that window until the switch transaction is finalized and the journal is cleared.

---

### (3) Answers to the 8 Open Questions in Section 12

#### 1. New Tab Override: Single Extension vs. Two Flavors
* **Recommendation:** **Ship as a single extension; do NOT maintain two build flavors.**
* **Explanation:** Redirecting an extension new tab page to `chrome://new-tab-page` is blocked by Chromium security policies. However, maintaining two separate listings in the Chrome Web Store splits your user reviews, increases maintenance overhead, and creates confusion. Instead, ship a single extension with the new tab override. In `newtab.html`, provide a setting: when the dashboard is toggled "off", render a minimal, zero-latency search interface that proxies browser search via `chrome.search.query`, or display clean instructions for managing the default page in `chrome://settings`.

#### 2. Lazy Restore: `tabs.create` + `tabs.discard` vs. `suspended.html` Placeholder
* **Recommendation:** **Use the `suspended.html` placeholder page.**
* **Explanation:** Calling `chrome.tabs.discard()` on an uncommitted or loading tab throws runtime exceptions in Chromium. Discard behavior also varies across forks (Brave blocks discards on certain tab types, while Arc has distinct memory managers). A dedicated `suspended.html` placeholder guarantees zero initial network load, operates consistently across all Chromium forks, renders titles and favicons instantly, and seamlessly redirects to the target URL upon tab focus.

#### 3. Preact + Signals vs. Solid vs. Svelte 5
* **Recommendation:** **Keep Preact + `@preact/signals`.**
* **Explanation:** Preact is ~4 KB, fully compatible with standard JSX tooling in Vite/WXT, and mature. Svelte 5 introduces runes with larger per-component runtime overhead, while Solid has a steeper learning curve for occasional open-source contributors. Signals provide clean, fine-grained reactivity.
* **Architectural Warning:** Signal instances are purely in-memory within their respective execution contexts (popup vs. sidepanel vs. newtab). All cross-surface synchronization must be driven by subscribing to `chrome.storage.onChanged` to update local signals.

#### 4. Storage Layout: Per-Workspace Key vs. Single Blob
* **Recommendation:** **Keep per-workspace keys, but split tabs from metadata.**
* **Explanation:** A single `workspaces` blob containing 50 workspaces × 50 tabs (2,500 tab objects) causes massive JSON serialization overhead on every tab change and triggers unnecessary `onChanged` events across all UI listeners. Per-workspace keys are far superior. However, divide each workspace into `workspace:meta:<id>` and `workspace:tabs:<id>` to isolate high-frequency tab writes from static user data.

#### 5. Direct UI Writes (CQRS-Lite) vs. Routing All Writes Through the SW
* **Recommendation:** **Route ALL writes through the Service Worker.**
* **Explanation:** The theoretical latency benefit of direct UI writes is negligible (<5 ms over local IPC). The downside is concurrency corruption: multiple open surfaces (popup, side panel, options) and the background worker competing to update shared keys without transactional guarantees. By routing all mutations through the Service Worker command router, you guarantee strict write serialization, single-point Valibot schema validation, and complete atomicity. UI surfaces should remain direct readers from `storage.local`.

#### 6. Tab Groups as Workspaces (Alternative Mode)
* **Recommendation:** **Do NOT implement workspaces as collapsed tab groups.**
* **Explanation:** The primary value of a workspace manager is reducing memory pressure and visual clutter. Keeping 200 tabs open across 10 collapsed tab groups consumes gigabytes of memory and strains Chrome's process model, even when discarded. Furthermore, Chrome's native tab group state is notoriously fragile across crashes and multi-window sessions. Keep workspaces virtualized (closed when inactive) and reserve native Tab Groups for grouping tabs *within* an active workspace.

#### 7. Naivety in the MV3 Lifecycle Plan (§5.2)
* **Recommendation:** **Yes, the lifecycle plan contains three critical blind spots:**
  1. *Sub-minute debouncing via alarms:* Alarms cannot debounce at 1–2 seconds.
  2. *Unreliable lifecycle hooks:* MV3 Service Workers do not reliably fire `runtime.onSuspend` before termination.
  3. *In-flight message death:* Long multi-tab switch operations can exceed the 30-second SW idle execution window if tabs stall, terminating the worker mid-operation.
  Ensure all multi-step operations are journaled to `storage.local` (not `storage.session`), and flush dirty states on tab removal events rather than waiting for alarms.

#### 8. Minimum Chrome Version: 116
* **Recommendation:** **Acceptable and recommended.**
* **Explanation:** Chrome 116 (released August 2023) is the milestone where `chrome.sidePanel` and stable programmatic discard APIs reached parity. All target Chromium forks (Edge 116+, Brave 1.58+, Opera 102+, Arc) have long passed this baseline. Requiring 116+ avoids complex polyfills for the side panel and covers over 98% of active Chromium users.

---

### (4) Tech-Stack Challenges

* **WXT (Vite-based): KEEP.** WXT is the gold standard for MV3 extensions. It handles multi-entrypoint manifest generation (popup, sidepanel, newtab, background), provides typed messaging utilities, and includes `@webext-core/fake-browser` for headless unit testing.
* **Preact 10 + `@preact/signals`: KEEP.** Maintains a tiny bundle footprint (<5 KB) with familiar React patterns. Avoid global state libraries (Zustand, Redux); signals wrapping `storage.onChanged` adapters are optimal for this architecture.
* **Valibot: KEEP.** At ~1–2 KB tree-shaken, it offers the exact schema validation needed for migration and JSON import without the 14+ KB bloat of Zod.
* **Fuzzysort: KEEP.** At ~3 KB with zero dependencies, it provides fast, score-ranked fuzzy searching across several thousand tab titles and URLs.
* **Biome: KEEP.** Replaces ESLint and Prettier with a single fast Rust binary, keeping CI execution under 5 seconds and lowering the barrier for open-source contributors.
* **Storage Layout: CHANGE.** Modify the schema in [§6](file:///Users/sajid/Developer/personal/tabitat/docs/ARCHITECTURE.md#L241-L252). Replace `workspace:<id>` with split keys: `workspace:meta:<id>` and `workspace:tabs:<id>`. Move `rt:windows` out of `storage.session` and into `storage.local` to survive browser restarts.

---

### (5) Missing Pieces a v1 Must Have

1. **Restricted Scheme & Protected URL Handling:**
   Extensions cannot inject scripts, discard, or navigate to protected URLs (`chrome://*`, `chrome-extension://*`, `edge://*`, `devtools://*`, and `chromewebstore.google.com`). Attempting to discard or restore these URLs throws uncaught exceptions. The engine must sanitize URLs and map protected URLs to safe placeholder pages during restore.
2. **Incognito Window Isolation Policy:**
   [§2](file:///Users/sajid/Developer/personal/tabitat/docs/ARCHITECTURE.md#L27) and [§10](file:///Users/sajid/Developer/personal/tabitat/docs/ARCHITECTURE.md#L361) omit incognito handling. If Tabitat runs in incognito windows (`incognito: "spanning"`), auto-saving incognito tabs into persistent `storage.local` leaks private browsing sessions to disk. The v1 specification must explicitly state that incognito windows are either ignored or handled in an isolated, in-memory ephemeral mode.
3. **Window Reconciliation on Browser Relaunch:**
   Because `windowId` integers are assigned arbitrarily on browser startup, Tabitat needs a deterministic algorithm in `runtime.onStartup` to reconcile reopened windows with their corresponding workspaces (e.g., matching open tab URLs against workspace snapshots).
4. **Emergency Recovery ("Panic Button"):**
   If a workspace switch fails mid-flight or storage becomes corrupted, users need a one-click emergency export in the popup/options: "Export all open tabs & workspaces to plain Markdown/HTML."
5. **Manifest Permission Correction:**
   In [§4](file:///Users/sajid/Developer/personal/tabitat/docs/ARCHITECTURE.md#L116-L119), `"commands"` is mistakenly included in the `permissions` array. In Manifest V3, `commands` is a top-level manifest key, not an API permission. Listing it under `permissions` causes a manifest validation error in Chromium.

---

### (6) Phase Plan Feedback

#### Critical Flaws in Ordering & Risk Allocation ([§11](file:///Users/sajid/Developer/personal/tabitat/docs/ARCHITECTURE.md#L372-L383))

```
Current Plan:
Phase 1: Core Engine ──> Phase 2: UI Surfaces ──> Phase 3: Dashboard Widgets ──> Phase 4: Session Guard & Export
                                                                                       ▲
                                                                                       └── SEVERE RISK: Safety net arrives too late!
Recommended Plan:
Phase 1: Core + Safety ──> Phase 2: UI & Workspaces ──> Phase 3: Suspension & Search ──> Phase 4: Dashboard Widgets
```

* **Premature Widget Expansion:** Placing Manganum dashboard features (Todos, Notes, Pomodoro, Wallpapers) in **Phase 3** while deferring critical data safety nets (`SessionGuard`, Export/Import, Recovery) to **Phase 4** is an anti-pattern. Tabitat’s core value is reliable tab management. If a bug during Phase 2 or 3 testing wipes a tester's tabs without an import/export or session safety net, the product fails its primary objective.
* **Missing Dogfooding Gate:** Workspace switching has numerous edge cases (closing windows, pinned tabs, tab groups, sound-playing tabs). A dedicated stabilization and dogfooding milestone must exist before building secondary widgets.

#### Recommended Re-phasing:
* **Phase 1:** Core domain, repository with split storage, TabTracker with event suppression, and **JSON Export/Import** (safety first).
* **Phase 2:** Popup & side panel UI, workspace switching engine with `suspended.html` placeholders, and **SessionGuard** (snapshots).
* **Phase 3:** Tab suspension, duplicate tab detection, universal search, keyboard shortcuts.
* **Phase 4:** New tab dashboard (widgets, todos, notes, pomodoro, wallpapers), settings sync.
* **Phase 5:** Polishing, a11y, store assets, v1.0.0 release.

---

### (7) Top 10 Concrete Changes to Make to the Document (Ranked)

| Rank | Section | Required Modification |
|:---|:---|:---|
| **1** | [§5.3 step 4](file:///Users/sajid/Developer/personal/tabitat/docs/ARCHITECTURE.md#L198-L202) | **Replace immediate discard with placeholder loading:** Explicitly mandate that lazy-restored tabs navigate to `suspended.html?url=...` instead of calling `chrome.tabs.discard()` directly after creation. |
| **2** | [§5.2](file:///Users/sajid/Developer/personal/tabitat/docs/ARCHITECTURE.md#L189-L191), [§5.4](file:///Users/sajid/Developer/personal/tabitat/docs/ARCHITECTURE.md#L210-L218) | **Replace `chrome.alarms` debounce with in-memory timers + immediate flush:** Use in-worker `setTimeout` for the 1–2 s debounce and bind immediate storage flushes to `tabs.onRemoved` and `windows.onRemoved`. |
| **3** | [§6](file:///Users/sajid/Developer/personal/tabitat/docs/ARCHITECTURE.md#L245) | **Decouple workspace storage keys:** Split `workspace:<id>` into `workspace:meta:<id>` (name, color, resources) and `workspace:tabs:<id>` (tab list snapshot) to eliminate read-modify-write collisions. |
| **4** | [§5.1](file:///Users/sajid/Developer/personal/tabitat/docs/ARCHITECTURE.md#L176-L180) | **Channel all mutations through the Service Worker:** Abolish direct UI writes to `storage.local`. Route all data and tab mutations through the typed RPC command router to ensure serialized, conflict-free operations. |
| **5** | [§5.3 step 1](file:///Users/sajid/Developer/personal/tabitat/docs/ARCHITECTURE.md#L194), [§6](file:///Users/sajid/Developer/personal/tabitat/docs/ARCHITECTURE.md#L277-L284) | **Move window-workspace mappings to persistent storage:** Relocate `rt:windows` to `storage.local` and define a startup reconciliation algorithm to reconnect restored windows to workspaces across browser restarts. |
| **6** | [§5.3](file:///Users/sajid/Developer/personal/tabitat/docs/ARCHITECTURE.md#L192-L206), [§5.4](file:///Users/sajid/Developer/personal/tabitat/docs/ARCHITECTURE.md#L210-L218) | **Add switching mutex to `TabTracker`:** Implement an event-suppression lock during workspace switching so that intermediate tab creations and removals do not corrupt workspace snapshots. |
| **7** | [§4](file:///Users/sajid/Developer/personal/tabitat/docs/ARCHITECTURE.md#L116-L119) | **Fix manifest permissions syntax:** Remove `"commands"` from the `permissions` array; keep it strictly as a top-level manifest configuration key. |
| **8** | [§11](file:///Users/sajid/Developer/personal/tabitat/docs/ARCHITECTURE.md#L372-L383) | **Reorder delivery phases:** Move `SessionGuard` and JSON Export/Import into Phase 1/Phase 2. Push non-core dashboard widgets (Todos, Notes, Pomodoro) to Phase 4. |
| **9** | [§2.1](file:///Users/sajid/Developer/personal/tabitat/docs/ARCHITECTURE.md#L29), [§10](file:///Users/sajid/Developer/personal/tabitat/docs/ARCHITECTURE.md#L361) | **Specify incognito window behavior:** Explicitly define that incognito windows are excluded from workspace tracking and storage to guarantee user privacy. |
| **10** | [§5.3](file:///Users/sajid/Developer/personal/tabitat/docs/ARCHITECTURE.md#L192-L206), [§10](file:///Users/sajid/Developer/personal/tabitat/docs/ARCHITECTURE.md#L369-L370) | **Add protected URL sanitization:** Specify how the restore planner handles privileged schemes (`chrome://`, `edge://`, `chrome-extension://`), replacing them with safe placeholder URLs. |
