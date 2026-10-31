# Tabitat UI spec — Phase 2 (popup, side panel, recovery)

Design goals: instant (paints from storage, no spinner on open), keyboard
first, dense but calm, identical components in popup and side panel,
light/dark via tokens in `src/ui/theme.css`. No web fonts, no icons font
(inline SVG, 16 px, `currentColor`). All strings via `src/i18n` (en only
for now, keys stable).

## Shared read model
Every surface reads with `useStorageKey` (storage.local + onChanged) and
writes only via `send()` RPC. Signals: `workspaces` (index + metas),
`currentWindowId` (`chrome.windows.getCurrent`), `windowState`,
`liveTabs` (via `chrome.tabs.query({currentWindow:true})` + tabs events;
the UI may activate, focus, or close a single tab directly: plain browser events
the tracker already auto-saves; anything that changes saved workspace state goes
through the `send()` RPC), `op` (`op.status`),
`recoveryPending`, `settings`.

## Popup (360 × 540)
```
┌──────────────────────────────────────────┐
│ ● Work ▾            [⌕] [▯ side] [⚙]     │  header: active workspace (color dot, name), menu ▾
│ ┌──────────────────────────────────────┐ │
│ │ ⌕ Search tabs, workspaces, links…    │ │  focused on open; ⌘⇧K also opens popup here
│ └──────────────────────────────────────┘ │
│ WORKSPACES                        + New  │
│ ● Work            12 tabs  ⟲ 2m   …      │  click = switch; … = open in new window / rename / color / delete
│ ○ Research         7 tabs                │  (active one has ● and is first)
│ ○ Personal         3 tabs                │
│ TABS IN THIS WINDOW (12)   [Suspend others] [Close 2 dupes] │
│ ▸ Group: Docs (3)                        │  tab groups collapsible, group color bar
│   favicon  Title…                 ✕  ⇩   │  click = activate; ✕ close; ⇩ park → saved links
│ SAVED LINKS (4)                   + add  │  click = open as tab; ✕ remove (undo toast)
│ RECENTLY CLOSED (3)                      │
├──────────────────────────────────────────┤
│ ⚠ Recovery available · Restore…          │  only when recovery:pending or last gen newer than tracked state
└──────────────────────────────────────────┘
```
Behaviour
- Typing in search filters all sections; results list shows hits across
  kinds with kind badge; ↑↓ navigate, Enter opens/switches, Esc clears,
  Esc again closes popup.
- Switching shows an inline progress row ("Switching to Research… 8/20")
  driven by `op.status` polling every 100 ms while an op exists; buttons
  disabled during op; errors render inline (busy/conflict text).
- New workspace: inline form (name, color swatches); default "from this
  window" with a checkbox "start empty".
- Delete workspace → immediate, with 8 s undo toast (trash.restore).
- Keyboard: `/` focuses search, `1–9` switch to nth workspace when search
  is empty, `n` new workspace, `s` open side panel.

## Side panel (min 320 px wide, full height)
Same sections as the popup, stacked with sticky section headers and more
room: workspaces as cards (name, color, tab count, last active), the tab
list (no drag reorder; the browser owns tab order), saved links with drag from
the tab list. Header has "Pin" hint removed (native). Opens via toolbar
button menu, popup button (`sidePanel.open` inside the click handler) or
command `toggle-side-panel`.

## Recovery page (`recovery.html`, opened in a tab)
- Section "Interrupted switch" when `recovery:pending`: shows from/to
  names, the frozen incoming tab list and the saved outgoing snapshot;
  actions: "Open incoming in new window", "Dismiss".
- Section "Session snapshots": generations list (time, windows, tab
  count); expand to see tabs; "Restore into new window"; "Export JSON".
- Section "Quarantined records" (`corrupt:*`): count + "Download" +
  "Delete".
- Section "Trash": workspaces/links with restore/purge.

## Badge
Action badge text = first letter/emoji of the active workspace for the
focused window, badge color = workspace color; cleared for Unsorted.
Title tooltip: "Tabitat — <workspace>".

## Components (src/ui/components)
`WorkspaceRow`, `WorkspaceForm`, `TabRow`, `TabGroupHeader`,
`SectionHeader`, `SearchBox`, `ResultRow`, `Toast` (+ `useUndoToast`),
`ProgressRow`, `EmptyState`, `IconButton`, `Kbd`. Each ≤ 120 lines,
no external UI libs.

## Accessibility
Roles (Phase 5): the workspace, tab, saved-link and recently-closed lists are `grid`/`row`/`gridcell` (primary cell + an "Actions" cell; ←/→ between cells, ↑/↓/Home/End between rows) with roving tabindex; search results stay `listbox`/`option` (combobox pattern); buttons have
labels; focus ring visible; color is never the only signal (name text +
dot). Respect `prefers-reduced-motion`.

Deliberate deviations from the ARIA Authoring Practices grid pattern: Home and End move between
rows (to the first or last row's primary cell), not between cells. Each row has one actions cell;
inside it →/← move between its buttons, ← on the first button returns to the primary cell and →
on the last stops. This simplifies the APG "widget mode" (Enter/Escape to enter and leave a cell).
On the dashboard workspace cards, ←/→ move to the neighbouring card and ↑/↓ to the card above or
below (the column count comes from the layout); the card menu opens with Shift+F10 or ContextMenu.
Deleting the last row of a list moves focus to the section heading (or to the search box when the
list had no heading). The options confirmation is an inline `group`, not a modal dialog: focus goes
to Cancel and Escape cancels.

## Performance
Popup JS ≤ 40 KB gz; first paint ≤ 100 ms measured in Playwright
(`performance.timing` + visible workspace list); no layout shift when
tabs load (reserve heights).
