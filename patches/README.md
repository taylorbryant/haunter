# Editor dependency patches

## BlockNote 0.54.0: native mobile input

`@blocknote%2Fcore@0.54.0.patch` fixes the node-view mutation filter in the
source, ESM bundle, and CommonJS bundle. Most of the patch's size comes from
the minified CommonJS line.

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

`features/pages/tests/editor-native-mutations.test.ts` tests the patched package
source directly because the filter is not a public export. Browser verification
must also exercise the distributed bundle when updating or removing this patch.
Do not remove the older Tiptap mobile patches without verifying their separate
React node-view freeze regression.

Validation:

- Run `bun test features/pages/tests/editor-native-mutations.test.ts` and
  `bun beignet check`.
- On iPhone Safari, type in a new inline code block, insert newlines, continue
  typing, wait for the save indicator, and reload. Check the code and line order.
- Press Return five times quickly in paragraphs, lists, and task blocks. Check
  that each press takes effect immediately and that the result survives reload.
- Repeat ordinary typing and Enter on desktop; check code language selection
  and the expanded code editor as well.

The automated WebKit iPhone-profile check reproduced five rapid Enter presses
creating only one paragraph before the patch and five afterward. It also
verified that replacing the inline code DOM enters autosave and survives a
reload. WebKit emulation does not replace a physical iPhone keyboard check.
