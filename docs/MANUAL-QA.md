# Manual QA checklist (things automation cannot drive)

Run before each phase tag on Chrome stable; before a release also on at least one of Brave or Edge,
both when available (Q15 is the smoke test for those two). Load `.output/chrome-mv3` unpacked (chrome://extensions, Developer
mode), or unzip the release zip and load that folder. Q11 needs the New Tab flavor
(`.output-newtab/chrome-mv3`); install only one flavor at a time.

| # | Check | Expected |
|---|---|---|
| Q1 | Press ⌘⇧K / Ctrl⇧K with the worker idle > 60 s | popup opens with search focused |
| Q2 | ⌘⇧. and ⌘⇧, | next / previous workspace switch in the focused window |
| Q3 | Popup → side panel button | side panel opens (gesture path) |
| Q4 | Assign a key to `toggle-side-panel` in chrome://extensions/shortcuts and press it | side panel opens |
| Q5 | Start a 30-tab switch, immediately stop the worker in chrome://serviceworker-internals | after the worker restarts (open popup), window shows exactly the target tabs, no duplicates, outgoing workspace intact |
| Q6 | Switch, then quit the browser mid-switch (⌘Q) and relaunch | recovery banner; both workspaces listed; nothing lost |
| Q7 | Close a window 200 ms after navigating a tab | reopening the workspace shows the new URL |
| Q8 | Import a backup in replace mode, then open Trash | previous workspaces present in trash |
| Q9 | Activate a placeholder in a window hidden behind another | it loads on click if not on focus |
| Q10 | edge://settings saved on Edge, opened on Chrome via import | listed as skipped, not an empty tab |
| Q11 | Newtab flavor: open a new tab in two windows that hold different workspaces; in each, switch workspace from the Workspaces card, then drag one new-tab page into the other window | each switch targets the window the new tab lives in (never the other one); the moved page follows its new window's workspace (scope switch, Todos/Notes "workspace" scope) |
| Q12 | Start a pomodoro on the dashboard, then put the machine to sleep (or hide the tab) past the phase end and wake it | the countdown is right immediately on return (no 1 s ticks while hidden), the phase / round change is announced once (screen reader), and the delayed alarm's notification fires once |
| Q13 | Onboarding. In a fresh browser profile install the zip (or Load unpacked); then restart the browser, and finally open Options, About, "Show the welcome tour" | on the first install `onboarding.html` opens in one tab with four cards (workspaces and the limitation, where things live, shortcuts with the current keys, privacy) and a Done button; after Done, and after a browser restart or an extension reload, it does not open again; "Show the welcome tour" opens it on demand; the shortcuts card shows the keys that `chrome://extensions/shortcuts` shows |
| Q14 | Screen reader spot check with VoiceOver (macOS, Cmd+F5) in Chrome: popup workspace list, row menu, toast | in the popup, Down Arrow moves row by row and each row is announced with its name and position (row N of M); Right Arrow moves from the row to its action buttons and Left Arrow back; the "..." menu announces its items and Esc returns focus to the row (its primary cell), not to the button; deleting a workspace announces the toast text (with Undo) once, without moving focus; a switch announces progress and an error banner is announced when one appears; icon-only buttons have spoken names. Also, on the dashboard with an image wallpaper, the focus ring is visible over the image on every control you reach with Tab |
| Q15 | Edge and Brave smoke: unzip `tabitat-<version>.zip`, Load unpacked, create a workspace from the current window, create a second one, switch back and forth, open the side panel, suspend a background tab, export a JSON backup | the extension loads without manifest errors; both workspaces list with correct tab counts; each switch shows exactly the target's tabs with no duplicates; the side panel opens from the popup button; the suspended tab is dimmed with the suspended glyph and its page reloads on click; the downloaded `tabitat-*.json` opens as valid JSON and contains both workspaces. Record any difference in `COMPATIBILITY.md` |
| Q16 | Bookmarks permission end to end (Chrome shows the real prompt; automation cannot). Open Options, Bookmarks, press "Choose bookmarks…"; accept the permission prompt; select a folder and import it as one workspace; then press "Remove bookmarks permission" on the same page; open `chrome://extensions`, Tabitat, Details | the prompt appears only after the button press (never at install); after accepting, the folder tree loads and the import reports the imported and skipped link counts and adds the workspace with those links as saved links; after removal the page says the permission was removed, the folder tree is gone, and the extension details no longer list bookmarks as granted; the imported workspace is still there |
| Q17 | Drag and drop, with a mouse. (a) Popup or side panel, with a workspace active: drag an unpinned open tab row onto the Saved links section. (b) Dashboard, quick links: drag one tile onto another. (c) Dashboard, Todos: drag one todo onto another (Alt+Up and Alt+Down do the same by keyboard). Reload the page after each | (a) the section shows a drop highlight, and the tab is added to Saved links and stays after a reload; (b) the tile moves to the target's position and the order persists after a reload; (c) the todo moves and the order persists after a reload. Workspaces cannot be reordered by drag |

## Results

Fill in one row per check and browser before tagging a release. Result is `pass`, `fail` or
`skip`; for `fail` and `skip`, say why in Notes and open an issue. Add rows as needed. Record the
build too (the version from Options, About, and the flavor). Add one row for the local end-to-end
run on the release commit (`npx playwright test --project=e2e`, which includes the axe suite):
number of tests passed and the Chrome version; see `docs/RELEASE.md`.

| Q | Browser / version | Result | Notes |
|---|---|---|---|
| Q1 |  |  |  |
| Q2 |  |  |  |
| Q3 |  |  |  |
| Q4 |  |  |  |
| Q5 |  |  |  |
| Q6 |  |  |  |
| Q7 |  |  |  |
| Q8 |  |  |  |
| Q9 |  |  |  |
| Q10 |  |  |  |
| Q11 |  |  |  |
| Q12 |  |  |  |
| Q13 |  |  |  |
| Q14 |  |  |  |
| Q15 |  |  |  |
| Q16 |  |  |  |
| Q17 |  |  |  |
| e2e (local) |  |  | tests passed, Chrome version, commit |

Release sign-off: Tabitat version ____ / flavor ____ / date ____ / tester ____
