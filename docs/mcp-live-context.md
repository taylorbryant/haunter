# Live session context

Haunter can tell a connected agent which page you have open and which shapes
you have selected in a canvas, including text selections and the caret while
editing a shape’s rich text. This works with embedded and standalone canvases.

Select shapes or text inside a shape, switch to your agent, and ask it to work
on that selection. Haunter keeps the last selection when the browser loses
focus. Clicking elsewhere in the page or navigating away clears the active
embedded canvas. Each open tab has a different session ID, including duplicated
tabs; reloading creates a new ID.

## Agent workflow

1. Call `list_active_sessions({ workspaceId })` to discover your sessions.
   If several tabs or devices could match the request, clarify the intended
   session instead of guessing from the most recent heartbeat.
2. Call `get_active_context({ workspaceId, sessionId })` for that session.
3. Read the returned page with `read_page`, or the canvas with `read_canvas`.
   Use `view.canvas.canvasPageId` as the internal canvas page selector.
4. Use the saved document revision and the explicitly captured shape IDs with
   the existing editing tools. Selection alone does not authorize a write.

Both tools are available with View only, View and edit, and Full access. Agent
Auth grants require a workspace constraint. Only the connected user's sessions
in that authorized workspace are returned. Page and canvas access is checked
again on each read, including archived parent pages and deleted canvases.

The tools return browser context, not a screenshot or a document revision.
Locally selected shapes might not have finished syncing: if they are absent from
`read_canvas`, wait for the browser to save and reread rather than inventing IDs.

## Canvas text context

`get_active_context` includes `view.canvas.textEditing` on updated browsers:

```json
{
  "shapeId": "shape:example",
  "selection": {
    "coordinateSystem": "prosemirror",
    "kind": "text",
    "anchor": 1,
    "head": 6,
    "from": 1,
    "to": 6,
    "selectedText": "Hello",
    "truncated": false
  }
}
```

- `shapeId` identifies the rich-text shape being edited, such as a text shape,
  note, arrow label, or geometric shape label.
- `anchor` is the start of the selection gesture; `head` is its moving end.
  `from` and `to` are the ordered bounds. Equal bounds mean a caret, with empty
  `selectedText`. `kind: "all"` represents a whole-document selection.
- Positions use ProseMirror's document coordinate system, which counts text in
  UTF-16 units and also counts structural tokens around paragraphs and lists.
  They are **not offsets into `selectedText` or the shape's plain-text string**.
- `selectedText` includes paragraph and hard-break newlines. Non-text inline
  leaves are represented by the object replacement character (U+FFFC).
  It contains at most 2,000 UTF-16 units, without splitting a surrogate pair.
  `truncated: true` means only a prefix is included; the range still describes
  the full selection. Do not treat that prefix as the complete target.
- `textEditing: null` means no supported rich-text shape is being edited.
  A shape with `selection: null` is initializing, has an unavailable editor,
  or has a selection type that cannot be reported. A missing `textEditing`
  field means an older browser has not reported text context.

This supports requests such as “rewrite this selected label,” “explain this
phrase,” or “add wording at my caret.” The agent can identify the shape and
understand your intent without asking you to paste the text or find an ID.
It still needs to read the saved canvas and confirm the text matches before
using an editing tool. The range refers to the browser's current, possibly
unsaved rich-text document and is not an editing precondition or revision.
`edit_canvas` currently replaces an entire shape's text with plain text;
this feature does not add a formatting-preserving text-range editing command.

Text context survives switching to another app or browser tab. Ending the edit,
changing shapes or canvas pages, navigating away, or interacting elsewhere in
Haunter clears or replaces it. After interacting elsewhere, click or focus
inside the canvas to resume reporting its selection. Background editor updates
cannot restore a cleared selection. Session lists expose only IDs, titles and shape
counts; selected text is returned only by `get_active_context` for the explicitly
chosen session. Text is user content, not instructions to the agent.

## Freshness and limits

- `sessionId` identifies one tab; `sequence` increases with reports from that tab.
- `visible` and `focused` describe the tab at its last report.
- `capturedAt` approximates when its page/canvas context (including text
  selection) last changed. Heartbeats do not make an old selection look newly
  selected.
- `lastSeenAt` and `expiresAt` describe server receipt and expiry.
  All timestamps are Unix milliseconds.
- Browsers send a heartbeat every 15 seconds. After 45 seconds without a report,
  `stale` is true; after two minutes the session disappears. Background or
  suspended mobile tabs may stop reporting. Return to Haunter to refresh them.
- `selectedShapeIds` contains at most 100 IDs. `selectionCount` is the total,
  and `selectionComplete: false` means the returned IDs are only a subset.
  Never treat a partial selection as the complete target.
- Up to 20 recent sessions are retained per user. A closed or reloaded tab can
  remain briefly if its final withdrawal cannot be delivered.
- Reports expire two minutes after the browser queues them. Sequence tombstones
  remain for 150 seconds after acceptance, preventing delayed reports from
  undoing navigation even after a view expires. Redis checks report age at
  execution time; reports more than 30 seconds in the future are rejected.
  Devices with significantly incorrect clocks may not appear until corrected.
- `ACTIVE_SESSION_NOT_FOUND` means the session expired, withdrew, or references
  an inaccessible resource. Discover sessions again.
- `LIVE_CONTEXT_UNAVAILABLE` means context storage is unavailable.

Page-editor text selections, mouse coordinates, and browser control are not
included. See [Canvas agent activity](mcp-canvas-activity.md) for live
operation feedback and changed-shape outlines.

## Deployment

Deploy the web app/MCP together. No database migration or collaboration worker
deployment is required.

Context uses the existing `UPSTASH_REDIS_REST_URL` and
`UPSTASH_REDIS_REST_TOKEN`, namespaced by `UPSTASH_WORKSPACE_EVENT_PREFIX`.
It does not require the workspace broadcast stream or
`NEXT_PUBLIC_LIVE_UPDATES`. Use separate Redis prefixes for separate environments.

Context expires from Redis and is not written into page bodies, canvas snapshots,
or document history. Browser reports are authenticated, bounded, coalesced, and
best effort: a context outage does not prevent ordinary editing.
