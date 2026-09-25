# Live session context

Haunter can tell a connected agent which page you have open and which shapes
you have selected in a canvas. This works with embedded and standalone canvases.

Select shapes, switch to your agent, and ask it to work on that selection. Haunter
keeps the last selection when the browser loses focus. Clicking elsewhere in the
page or navigating away clears the active embedded canvas. Each open tab has a
different session ID, including duplicated tabs; reloading creates a new ID.

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

## Freshness and limits

- `sessionId` identifies one tab; `sequence` increases with reports from that tab.
- `visible` and `focused` describe the tab at its last report.
- `capturedAt` approximates when its page/canvas selection last changed.
  Heartbeats do not make an old selection look newly selected.
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

Text selections, caret positions, mouse coordinates, and browser control are
not included. See [Canvas agent activity](mcp-canvas-activity.md) for live
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
