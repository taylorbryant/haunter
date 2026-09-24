# Edit canvases through MCP

Add diagrams to pages with `create_canvas_block`, inspect their structure with
`read_canvas`, see the rendered drawing with `preview_canvas`, and change their
shapes with `edit_canvas`. These tools create native tldraw
shapes that you can continue editing in Haunter.

Each call requires a `workspaceId` from `list_workspaces`. Canvas reads and edits
require a running collaboration worker. Page and canvas revisions are separate:
use the revision returned by the tool for the resource you are changing.

## Add a canvas to a page

Read the page with `read_page`, then call `create_canvas_block`:

```json
{
  "workspaceId": "YOUR_WORKSPACE_ID",
  "pageId": "YOUR_PAGE_ID",
  "expectedRevision": "REVISION_FROM_READ_PAGE"
}
```

This appends an empty canvas block to the page. The canvas and its block are
created together; a failed call creates neither. The response includes `canvasId`,
`canvasRevision`, the new page `revision`, `insertedBlockIds`, and the page's
`historyVersionId`. Page history preserves the canvas reference, not its drawing.

To find an existing embedded canvas, call `read_page` with `format: "blocks"`
and look for a block with `type: "canvas"` and `props.canvasId`. Existing standalone
canvases can also be read and edited when you have their canvas ID.

## Read a drawing

Call `read_canvas` with `workspaceId` and `canvasId`. The response contains:

- `revision`: the token required for the next edit or deletion.
- `pages`: tldraw page IDs and names. These are different from Haunter page IDs.
- `shapes`: native IDs, types, parent IDs, positions, rotation, lock state,
  plain text, and native properties.
- `bindings`: connections between shapes, including arrow endpoints.
- `history`: IDs, revisions, and timestamps for retained snapshots.

Reads include shape types that these tools cannot edit. Coordinates for nested
shapes are relative to their parent. Keep unsupported shapes unchanged.

## Create and connect shapes

Pass the latest canvas revision to `edit_canvas`. Operations run in order as one
batch. A `ref` gives a newly created shape a name that later operations in the
same batch can use. The response maps these names to native IDs in `createdShapes`.

```json
{
  "workspaceId": "YOUR_WORKSPACE_ID",
  "canvasId": "YOUR_CANVAS_ID",
  "expectedRevision": "REVISION_FROM_READ_CANVAS",
  "operations": [
    {
      "op": "create", "ref": "api", "type": "rectangle",
      "x": 0, "y": 0, "text": "API server"
    },
    {
      "op": "create", "ref": "database", "type": "ellipse",
      "x": 400, "y": 0, "text": "Database"
    },
    {
      "op": "connect", "ref": "query",
      "fromId": "api", "toId": "database", "text": "Query"
    }
  ]
}
```

| Operation | Fields and behavior |
| --- | --- |
| `create` | Requires `ref`, `type`, `x`, and `y`. Types: `rectangle`, `ellipse`, `diamond`, `text`, `note`. Optional `text`, `color`, and tldraw `pageId`. Specify `pageId` when the canvas has multiple pages. Geometry accepts `width` and `height`, defaulting to 240 × 120. Text accepts `width`, defaulting to 240. Notes use their native fixed size and reject dimensions. |
| `update` | Requires `shapeId` and at least one of `x`, `y`, `text`, `color`, `width`, or `height`. Omitted fields stay unchanged. Only geometry and text accept width; only geometry accepts height. Text replaces the label's rich text with plain text. |
| `connect` | Requires `ref`, `fromId`, and `toId`; optional `text` and `color`. Creates a bound arrow between distinct nodes on the same canvas page. Connections follow nodes when they move. Arrows cannot connect to other arrows. |

Updates and connections support unlocked `geo`, `text`, `note`, and `arrow`
shapes directly on a tldraw page. Move a connected node to change an arrow's path;
the API does not translate arrows. Use the canvas editor for groups, frames,
images, freehand drawings, rich text formatting, rotation, and other shape types.
Locked and nested shapes are rejected.

Colors are `black`, `grey`, `light-violet`, `violet`, `blue`, `light-blue`,
`yellow`, `orange`, `green`, `light-green`, `light-red`, `red`, and `white`.
Shape references start with a letter and contain up to 64 letters, digits,
underscores, or hyphens. Native IDs start with `shape:`.

An edit accepts up to 100 operations. Text is limited to 5,000 characters per
operation; dimensions to 1–10,000 canvas units; coordinates to ±1,000,000.
The command must fit within 1 MB. Saved drawings retain the existing canvas
limits of 30,000 records and 5 MB of record JSON, with an 8 MiB room limit.
There is no automatic layout, text sizing during edits, or Mermaid import.

## Preview a drawing

Call `preview_canvas` after an edit to check labels, spacing, and connections:

```json
{
  "workspaceId": "YOUR_WORKSPACE_ID",
  "canvasId": "YOUR_CANVAS_ID",
  "expectedRevision": "REVISION_FROM_EDIT_CANVAS"
}
```

Hosted MCP returns a native PNG image content item alongside text and structured
metadata: `canvasId`, `revision`, `pageId`, `shapeIds`, pixel `width` and `height`,
and `bounds` (`x`, `y`, `width`, `height`) in canvas coordinates. Agent Auth
returns the same metadata with `image: { mimeType: "image/png", data: "BASE64" }`.

- Omit `expectedRevision` to capture the latest durable state. If provided and
  stale, the call fails with `CANVAS_REVISION_CONFLICT` before rendering.
- A canvas with multiple tldraw pages requires `pageId` from `read_canvas`.
- Optional `shapeIds` focuses on up to 100 shapes, including their descendants.
  Arrows are included only when selected or inside a selected group/frame.
  Omit `shapeIds` for the whole page; an empty array is invalid.
- The preview uses tldraw's native renderer, bundled fonts, light theme, an
  opaque background, 32 canvas units of padding, and at most 1600 pixels per
  side. An empty page returns a blank 640 × 360 image.
- Native geometry, text, notes, arrows, lines, freehand drawings, highlights,
  groups and frames are supported. Selected images, videos, bookmarks, and
  embeds return `INVALID_CANVAS_PREVIEW`. Use `shapeIds` to select supported
  shapes on a mixed page. Pages are limited to 1000 shapes, including children.
- Rendering uses a detached snapshot and does not hold the canvas editing
  queue. The returned revision identifies that snapshot; newer edits can
  arrive while it renders. A preview does not create history or alter shapes.

The worker renders one preview at a time in a fresh browser context with no
network access beyond locally served renderer assets and fonts. Images are
returned directly and are not saved or published to a URL. A busy renderer,
timeout, missing browser, or oversized image returns `CANVAS_PREVIEW_UNAVAILABLE`;
retry after a short delay. Access is checked again before returning the image.

## Delete shapes

`delete_canvas_shapes` requires Full access and accepts `workspaceId`, `canvasId`,
`expectedRevision`, and `shapeIds` (up to 100 native IDs). Include connected arrows
in the same deletion batch when deleting their target nodes. Deleting an arrow
also removes its bindings. Unsupported, locked, or nested shapes must be removed
in the canvas editor. The operation deletes drawings, not the page's canvas block.

## Conflicts, permissions, and history

| Permission | Allowed canvas operations |
| --- | --- |
| View only | Read current drawings and retained history, and preview current drawings. |
| View and edit | Also add canvas blocks, create shapes, update shapes, and connect nodes. |
| Full access | Also delete shapes. |

Local Agent Auth requires an explicit workspace-scoped grant for each tool.
Workspace membership and content permissions still apply. Canvases attached to
archived pages cannot be read or edited through these tools.

Canvas writes return `canvasId`, `revision`, `createdShapes`, and
`historyVersionId`. Each successful batch saves its previous drawing in canvas
history, which retains the latest 50 agent snapshots. Read an older drawing by
passing its `historyVersionId` to `read_canvas`. Its returned revision describes
that older drawing and cannot authorize a current edit. You can inspect old
properties and use them to prepare targeted corrections against a fresh read.
There is no whole-canvas restore tool or canvas history UI in this release.

On `CANVAS_REVISION_CONFLICT`, read the canvas again and reconsider the edit. The
hosted MCP error includes `currentRevision`. On `CANVAS_WORKER_UNAVAILABLE`, read
the canvas after connectivity recovers before retrying: a lost response can mean
that an edit committed but its reply did not arrive. Repeating a successful write
with its old revision cannot apply it again.

Invalid batches and failed database transactions publish no partial changes.
Open editors receive committed changes through collaboration. Revisions cover
changes received by the worker; a disconnected client's pending changes are not
included. Concurrent edits to the same shape property follow tldraw's normal
conflict behavior and should be reviewed after reconnection.

## Deployment

Apply migration `0044_thin_iceman.sql` before deploying these tools, then deploy
both Next.js and the collaboration worker. The web server uses the HTTP(S)
equivalent of `NEXT_PUBLIC_COLLABORATION_URL` to reach
`POST /internal/canvas-command`. Forward that path through the worker's proxy as
well as its WebSocket routes. Both services must share `BETTER_AUTH_SECRET`;
the route verifies a short-lived signature over the entire request. An older
worker returns `CANVAS_WORKER_UNAVAILABLE` for canvas reads and edits.

Previews require deploying both the updated web app and worker, with no new
database migration beyond the canvas editing migration above. The worker
Dockerfile installs Playwright's pinned Chromium headless shell and its system
dependencies. For local workers and tests, install the browser once after
`bun install` (repeat after upgrading Playwright):

```sh
bunx --bun playwright install chromium --only-shell
```

On Linux, add `--with-deps` to install system dependencies. Supply
`NEXT_PUBLIC_TLDRAW_LICENSE_KEY` to the worker as well as the web app when using
a tldraw license. The browser and tldraw bundle run only in the collaboration
worker; the web app forwards authenticated requests. Browser startup has an
8-second timeout and rendering a 15-second timeout within the command bridge's
30-second request deadline. Monitor worker memory under preview load; each
request starts a separate Chromium process with one render allowed at a time.

Follow the [collaboration deployment guide](collaboration.md#worker-deployment)
for worker configuration and the single-worker requirement.
