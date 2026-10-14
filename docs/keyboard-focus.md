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

## Testing focus changes

Test keyboard and pointer entry into dialogs at desktop and mobile widths.
Include nested pickers, menu-to-dialog handoffs, inline rename save/cancel, and
return focus after a save replaces the original DOM node. Repeat in the embedded
host when changing shared popup behavior; it adds an outer focus boundary.

Use a physical mobile browser when checking touch keyboards or screen readers;
a narrow desktop viewport does not reproduce them. The fullscreen code editor
uses Tab for indentation, and tldraw can consume Escape before its fullscreen
container closes.

Run `bun beignet check` for the component regression tests.

After changing popup primitives, repeat the browser checks with real closing
animations. Include a previously opened, unrelated popup: otherwise stale
return-focus targets can appear correct in an isolated test. Refresh the app
after code changes before evaluating focus; hot reload can replace launchers.
