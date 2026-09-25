# Canvas agent activity

When a connected agent uses `read_canvas`, `preview_canvas`, `edit_canvas`, or
`delete_canvas_shapes`, the open canvas shows the agent's name, the workspace
member who connected it, and the action in progress. This works in embedded and
standalone canvases, for remote MCP connections and registered Agent Auth agents.

Successful calls briefly show completion feedback; unsuccessful calls show
“Canvas action failed.” A failure can include an interrupted connection, so it
does not prove that the drawing was unchanged. Inspect the canvas before retrying.
The indicator describes actual tool execution, not an agent's thinking time or
the completion of its entire task. Creating a canvas block continues to use the
existing page activity indicator until the agent operates on the new canvas.

After a successful edit, created shapes, new arrows, and explicitly updated
shapes receive a violet outline for six seconds. Outlines follow the current
canvas page and viewport. They do not select shapes, move the camera, capture
pointer input, change the drawing, or add undo/history entries. Deleted shapes
have completion feedback but no outline. Shapes that arrive through sync during
the six-second window are outlined when they appear.

## Delivery and expiry

Activity uses the opt-in `workspace.canvas-activity.v1` channel, sharing the
existing authenticated stream and connection lease with workspace updates.
The `workspace.changes` channel and its schema stay unchanged, so tabs running
an older release continue receiving ordinary updates without seeing unfamiliar
activity events. Both channels recheck workspace membership on connection and renewal. Workspace
members with an open canvas can see the activity there; public shared canvases
do not subscribe. Events contain identifiers, attribution, action, phase, and
up to 100 changed shape IDs, never shape text, images, or raw error messages.
Capability grants, current membership, canvas access, and parent-page access are
checked before broadcasting a start event.

- Active indicators expire after 60 seconds if completion is not received.
- Completion and failure feedback lasts 15 seconds; outlines last six seconds.
- Terminal events prevent delayed start events from reviving finished actions.
- Concurrent calls have separate operation IDs. Active work takes precedence
  in an agent's status while completed edits can still be highlighted.
- Disconnecting, changing workspaces/accounts, or renewing the event stream
  clears cached activity. Events are transient and are not replayed on reconnect.

Broadcasting is best effort, with a one-second preparation/publication budget
and a separate one-second completion publication budget. Unavailable activity
delivery cannot fail or indefinitely delay an otherwise valid canvas operation.

## Release

Deploy the web app/MCP. No database migration or collaboration worker deployment
is required. The existing workspace broadcast configuration must be enabled:
`NEXT_PUBLIC_LIVE_UPDATES=true`, `REDIS_BROADCAST_URL`, the matching
`REDIS_BROADCAST_PREFIX`, and Upstash Redis REST credentials used for stream
leases. Live session context alone does not require this stream, but canvas
activity indicators do. Without it, canvas tools continue to work normally.
