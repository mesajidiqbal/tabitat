# Manual QA checklist (things automation cannot drive)

Run before each phase tag on Chrome stable; Brave and Edge before release.
Load `.output/chrome-mv3` unpacked (chrome://extensions → Developer mode).

| # | Check | Expected | Chrome | Brave | Edge |
|---|---|---|---|---|---|
| Q1 | Press ⌘⇧K / Ctrl⇧K with the worker idle > 60 s | popup opens with search focused | | | |
| Q2 | ⌘⇧. and ⌘⇧, | next / previous workspace switch in the focused window | | | |
| Q3 | Popup → side panel button | side panel opens (gesture path) | | | |
| Q4 | Assign a key to `toggle-side-panel` in chrome://extensions/shortcuts and press it | side panel opens | | | |
| Q5 | Start a 30-tab switch, immediately stop the worker in chrome://serviceworker-internals | after the worker restarts (open popup), window shows exactly the target tabs, no duplicates, outgoing workspace intact | | | |
| Q6 | Switch, then quit the browser mid-switch (⌘Q) and relaunch | recovery banner; both workspaces listed; nothing lost | | | |
| Q7 | Close a window 200 ms after navigating a tab | reopening the workspace shows the new URL | | | |
| Q8 | Import a backup in replace mode, then open Trash | previous workspaces present in trash | | | |
| Q9 | Activate a placeholder in a window hidden behind another | it loads on click if not on focus | | | |
| Q10 | edge://settings saved on Edge, opened on Chrome via import | listed as skipped, not an empty tab | | | |
