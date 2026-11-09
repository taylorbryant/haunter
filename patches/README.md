# Editor dependency patches

## BlockNote: native mobile input

[`package.json`](../package.json) registers the patch for the installed
`@blocknote/core` version. BlockNote 0.57 is ESM-only and no longer ships its
TypeScript source. The patch fixes the node-view mutation filter in the shipped
`getDefaultSlashMenuItems-*.js` bundle. Rebase it when upgrading BlockNote.

Safari can split an editable paragraph or code block into a sibling element,
or replace the editable element itself. BlockNote ignored these changes because
their mutation targets were outside its original `contentDOM`. Consequently,
code edits could remain in the DOM without entering the document/save pipeline.
Repeated Enter presses could collapse into ProseMirror's final 200 ms fallback.

The patch lets ProseMirror read replacement of `contentDOM` (or an ancestor)
and sibling insertions that receive the editable DOM selection. Attribute
changes, toolbar changes, and unrelated insertions remain ignored. Existing
custom filters still handle mutations inside `contentDOM`. React moving the
existing editable element within its node view is also excluded.

The [mutation regression tests](../features/pages/tests/editor-native-mutations.test.ts)
extract and exercise the mutation filter from the patched bundle because it is
not a public export. Keep the bundle filename and private function name in the
tests aligned when rebasing. Browser verification must also exercise the full
distributed bundle when updating or removing this patch.

Validation:

- Run `bun test features/pages/tests/editor-native-mutations.test.ts` and
  `bun beignet check`.
- On iPhone Safari, type in a new inline code block, insert newlines, continue
  typing, wait for the save indicator, and reload. Check the code and line order.
- Press Return five times quickly in paragraphs, lists, and task blocks. Check
  that each press takes effect immediately and that the result survives reload.
- Repeat ordinary typing and Enter on desktop; check code language selection
  and the expanded code editor as well.

WebKit emulation does not replace a physical iPhone keyboard check.
