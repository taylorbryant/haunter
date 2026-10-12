# Keyboard focus

## Expected behavior

- Opening a creation dialog focuses its primary input. Tab and Shift+Tab stay
  inside the dialog; Escape closes it and returns to the control that opened it.
- A menu action that opens a dialog transfers focus to that dialog. The menu's
  closing animation must not pull focus back underneath the dialog.
- Navigation commands keep the palette's normal return-focus behavior. Only
  commands marked `opensDialog` suppress it to hand focus to the new dialog.
- Closing a nested picker returns to its control in the parent dialog. Escape
  dismisses one layer at a time.
- Enter or Escape finishes an inline rename and focuses the same row's title.
  Clicking or tabbing away keeps focus on the user's chosen control, including
  while an asynchronous save finishes.
- When saving replaces the original DOM node, restore focus to the current
  equivalent control. The fullscreen code editor uses the code block's current
  expand button, or the editor if the block was removed.

Use Base UI's `initialFocus` for dialog inputs rather than React `autoFocus`:
the dialog needs to capture its launcher before moving focus inside. Prefer
the library's default return-focus behavior; unconditional overrides can either
lose focus or steal it from another open dialog. Inline editors can still use
`autoFocus` when they replace a title following an explicit action.

## Audit coverage (October 2026)

The audit used the isolated local preview fixture, a real Chromium browser at
desktop and mobile widths, and component regression tests. It covered:

| Area | Checks |
| --- | --- |
| Command palette | Page, canvas, and task creation by keyboard and pointer through the real mobile sidebar; Home/Tasks navigation, dismissal, and return focus |
| Creation dialogs | Initial input, Tab containment, and return to the actual launcher after using unrelated popups |
| Sidebar | Page action handoff to icon/trash dialogs; inline rename cancellation; mobile sidebar and workspace drawer dismissal |
| Workspace menu | Escape, new/edit workspace and members dialog handoff, and return to the switcher |
| Tasks | Inline rename save/cancel/click-away; delete confirmation cancellation; nested assignee and date pickers |
| Page controls | Share dialog, history, import Markdown, draft recovery, and trash confirmation focus |
| Code blocks | Fullscreen input focus and return after the node view is replaced on save |
| Canvases | Rename dialog, library dismissal, fullscreen Tab wrapping and return to the expand control |
| Account menu | Settings and changelog initial focus, Tab containment, and dismissal |

Fixed findings were workspace-menu dismissal losing focus, creation dialogs
returning to an unrelated previous popup, inline page/task renames losing focus,
and fullscreen code editing returning to a removed node. Hidden sidebar
tooltips are disabled so they cannot consume Escape before the mobile sheet.
The sidebar rename input also gained an accessible name.

This is focus coverage, not a complete accessibility certification. Mobile
checks used a narrow Chromium viewport, not physical iOS/Safari or VoiceOver.
Permission changes, invitation delivery, permanent deletion, and external auth
flows were not submitted. The browser run used the regular web app; shared
components are covered by tests, but the embedded host's outer focus boundary
still needs its own smoke test. The fullscreen code editor intentionally uses
Tab for indentation; Escape remains available to leave it. Tldraw can consume
Escape before the fullscreen canvas closes.

## Regression checks

Run `bun beignet check` before shipping. Focus regressions live in:

- `features/search/tests/command-focus.test.tsx`
- `features/pages/tests/page-tree-focus.test.tsx`
- `features/pages/tests/code-edit-dialog-focus.test.tsx`
- `features/tasks/tests/task-list-mutations.test.tsx`
- `features/workspaces/tests/workspace-picker-focus.test.tsx`

After changing popup primitives, repeat the browser checks with real closing
animations. Include a previously opened, unrelated popup: otherwise stale
return-focus targets can appear correct in an isolated test. Refresh the app
after code changes before evaluating focus; hot reload can replace launchers.
