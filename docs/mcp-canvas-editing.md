# Edit canvases through MCP

Add diagrams to pages with `create_canvas_block`, inspect their structure with
`read_canvas`, see the rendered drawing with `preview_canvas`, and change their
shapes with `edit_canvas`. Use `search_canvas_library` and
`insert_canvas_library_item` to start from built-in templates and components.
These tools create native tldraw shapes that you can continue editing in Haunter.

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

To reorder canvas blocks within a page, use the `move` operation in
[`edit_page_blocks`](mcp-page-editing.md#edit-selected-blocks), using each page block's
`id` rather than its `props.canvasId`. This preserves the drawings and avoids
replacing the whole page body.

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
| `create` | Requires `ref`, `type`, `x`, and `y`. Types: `rectangle`, `ellipse`, `diamond`, `text`, `note`, `frame`. Optional `text`, `color`, and tldraw `pageId`. Set `parentId` to a group/frame ID or earlier reference to add a child; otherwise specify `pageId` when the canvas has multiple pages. If both are supplied, the parent must belong to that page. Geometry accepts `width` and `height`, defaulting to 240 × 120. Text accepts `width`, defaulting to 240. Notes use their native fixed size and reject dimensions. |
| `update` | Requires `shapeId` and at least one of `x`, `y`, `text`, `color`, `width`, or `height`. Positions are relative to the shape's immediate parent, as returned by `read_canvas`. Omitted fields, parent IDs and rotations stay unchanged. Geometry, text and frames accept width; geometry and frames accept height. Groups accept movement only. For frames, `text` changes the frame name; for leaves it replaces the label's rich text with plain text. |
| `connect` | Requires `ref`, `fromId`, and `toId`; optional `text` and `color`. Creates a bound arrow between distinct nodes sharing the same immediate parent: a page, group, or frame. The arrow is created under that parent and follows the nodes when they move. Arrows cannot connect to other arrows. |

Updates and connections support unlocked `geo`, `text`, `note`, and `arrow`
leaf shapes on a tldraw page or inside groups and frames, including nested groups.
A lock on any ancestor blocks edits, creation, connections and deletion inside it.
Move a connected node to change an arrow's path; the API does not translate arrows.
Groups and frames can also be organized through the operations below. Use the
canvas editor to edit image crops/pixels, freehand points, rich text formatting, rotation,
and other unsupported properties.

## Organize groups and frames

`edit_canvas` also accepts these operations. IDs can be native IDs from
`read_canvas` or references created earlier in the same batch.

| Operation | Behavior |
| --- | --- |
| `create` with `type: "frame"` | Create a frame; `text` names it, `width`/`height` default to 800×600. Optional `parentId` accepts a group/frame ID or earlier reference. Creating a frame does not automatically capture shapes beneath it. |
| `group` | Supply a new `ref` and 2–100 distinct sibling `shapeIds`. Creates one group while preserving the drawing's placement and bindings. |
| `ungroup` | Supply a group `shapeId`. Removes the group and reparents its children to its parent, preserving their page positions and rotations. |
| `update` on a container | Groups accept `x`/`y` movement. Frames also accept `width`, `height`, `text` (name), and `color`. Moving a container moves its contents; resizing a frame changes its boundary without scaling children. |
| `reparent` | Supply 1–100 `shapeIds` and a `parentId` identifying a canvas page, group or frame. Moves shapes into that container while preserving their page positions and rotations. |
| `align` | Supply 2–100 `shapeIds` and `alignment`: `left`, `center-horizontal`, `right`, `top`, `center-vertical`, `bottom`, or `center`. Aligns native page bounds, including measured text. |
| `distribute` | Supply 3–100 `shapeIds` and `direction`: `horizontal` or `vertical`. Keeps the outer shapes in place and equalizes gaps between their bounds. Gaps may overlap if space is insufficient. |

For example, organize an existing component inside a named frame:

```json
{
  "workspaceId": "YOUR_WORKSPACE_ID",
  "canvasId": "YOUR_CANVAS_ID",
  "expectedRevision": "REVISION_FROM_READ_CANVAS",
  "operations": [
    { "op": "group", "ref": "component", "shapeIds": ["shape:box", "shape:label"] },
    { "op": "create", "ref": "section", "type": "frame", "x": 0, "y": 0,
      "width": 1200, "height": 800, "text": "Sign in" },
    { "op": "reparent", "shapeIds": ["component"], "parentId": "section" },
    { "op": "update", "shapeId": "section", "x": 200 }
  ]
}
```

Use actual shape IDs from `read_canvas`. Grouping, ungrouping, reparenting and
layout preserve rotations. Create/update positions remain relative to the
immediate parent; reparenting instead preserves page placement. Alignment and
distribution work in page coordinates even under rotated parents.

Select shapes on the same canvas page, and select a container or its children,
never both. Grouping requires the same immediate parent. Reparenting cannot
create cycles or cross canvas pages. A source group must retain at least two
children; explicitly ungroup it first otherwise. Native arrows follow their
connected nodes and tldraw manages their parent and stacking order. For layout,
select nodes or whole components instead of individual arrows.

Organization supports geometry, text, notes, arrows, lines, freehand drawings,
highlights, groups and frames. Selected containers must contain only supported,
unlocked shapes. Locked targets, ancestors, descendants, or indirectly changed
arrows reject the entire batch. Unrelated unsupported shapes remain untouched.

These operations use a detached native tldraw editor with bundled fonts and no
external network access. The canvas must contain at most 1,000 shapes, and the
worker shares one browser job slot between organization and previews, with at
most two waiting jobs. Preparation has a 20-second deadline including queue wait
and browser startup, followed by at most four seconds for cleanup. A missing/busy browser or timeout returns
`CANVAS_WORKER_UNAVAILABLE`; reread before retrying. The canvas's mutation queue
is held during preparation so concurrent writes cannot invalidate its revision.
Access is checked again before saving. No partial changes or temporary editor
user records are published. Ordinary leaf-only batches keep their browser-free
path. There is no automatic diagram routing, container scaling or Mermaid import.

## Find and insert library items

Library tools are available after deploying this release. Search requires View
only access and does not need the collaboration worker. Insertion requires View
and edit access and an updated worker.

Call `search_canvas_library` to find a template or component:

```json
{
  "workspaceId": "YOUR_WORKSPACE_ID",
  "query": "mobile",
  "kind": "template",
  "category": "wireframes"
}
```

`query`, `kind`, and `category` are optional. Search matches IDs, names,
descriptions, categories and keywords without case sensitivity. Omit `query` to
browse. `kind` accepts `component` or `template`; `category` accepts `architecture`
or `wireframes`. Results include `total` matches and `items` with `id`, `version`,
`name`, `description`, `keywords`, `kind`, `category`, nominal `width`/`height` at
scale 1, and `shapeCount` excluding the group. `limit` defaults to 50 (maximum 50);
`offset` defaults to 0. Increase `offset` to read subsequent results.

Read the destination canvas, then call `insert_canvas_library_item`. Use the item
ID and version from search and the canvas revision from `read_canvas`:

```json
{
  "workspaceId": "YOUR_WORKSPACE_ID",
  "canvasId": "YOUR_CANVAS_ID",
  "expectedRevision": "REVISION_FROM_READ_CANVAS",
  "itemId": "mobile-app-screen",
  "itemVersion": 8,
  "x": 200,
  "y": 300,
  "scale": 1
}
```

The example uses library version 8; always pass the version returned by search.
`x` and `y` position the library item's origin in canvas page coordinates, within
±1,000,000 units. `scale` defaults to 1 and accepts 0.1–4. The nominal dimensions
from search help reserve space; rendered text can extend beyond them. Specify
`pageId` from `read_canvas` when the canvas has multiple tldraw pages. Insertion
places the item on that page; it does not insert into an existing group/frame,
automatically avoid overlapping shapes, or change your selection or viewport.

The response includes `canvasId`, `revision`, `historyVersionId`, `itemId`,
`itemVersion`, `pageId`, `rootShapeId`, `groupId`, and `shapeIdsByKey`. Multi-shape
items are grouped; for a single-shape item, `groupId` is null and `rootShapeId`
identifies that shape. `shapeIdsByKey` maps names from the template, such as
`title` or `submit-label`, to native shape IDs. These are ordinary editable shapes,
not linked instances that update when the library changes.

Use a returned part ID in `edit_canvas` to change its label, color, or supported
geometry. Use the insertion response's `revision` as `expectedRevision` for that
edit. To inspect the whole insertion with `preview_canvas`, pass
`shapeIds: [rootShapeId]`; its descendants and bound arrows are included.

Each insertion saves the prior drawing in history. A failed insertion publishes
no partial shapes or bindings. Stale canvas revisions return
`CANVAS_REVISION_CONFLICT`; read again before retrying. Unknown item IDs and
version mismatches return `INVALID_CANVAS_EDIT`. Search again on a version
mismatch; if the returned version is still rejected, check that the worker and
web app have matching releases.

## Customize a grouped template

Templates inserted from Haunter's library are groups. Read the canvas to find
the group's ID and its child shapes, then target those child IDs with the same
editing tools. For example:

```json
{
  "workspaceId": "YOUR_WORKSPACE_ID",
  "canvasId": "YOUR_CANVAS_ID",
  "expectedRevision": "REVISION_FROM_READ_CANVAS",
  "operations": [
    { "op": "update", "shapeId": "shape:heading", "text": "My tasks" },
    { "op": "update", "shapeId": "shape:panel", "width": 500 },
    {
      "op": "create", "ref": "button", "type": "rectangle",
      "parentId": "shape:template-group", "x": 24, "y": 400,
      "width": 180, "height": 48, "text": "Add task"
    }
  ]
}
```

Use actual shape IDs from `read_canvas` in place of these examples. Create and
update `x`/`y` values are in the immediate parent's coordinate system. On a page,
these are canvas coordinates; inside a rotated group or frame, the parent
transform determines where they appear. Dimensions are local to the shape.
Read the ancestor records when planning a layout; screen or whole-page positions
must not be passed as child-local positions.

Edits preserve group membership, ancestor transforms, metadata and omitted
properties. Connections across different parents are rejected. Use `update` with the returned `rootShapeId` to move the whole component,
`reparent` to place it inside a frame, or `align`/`distribute` to arrange several
components. Membership changes only when explicitly requested.

Colors are `black`, `grey`, `light-violet`, `violet`, `blue`, `light-blue`,
`yellow`, `orange`, `green`, `light-green`, `light-red`, `red`, and `white`.
Shape references start with a letter and contain up to 64 letters, digits,
underscores, or hyphens. Native IDs start with `shape:`.

An edit accepts up to 100 operations. Text is limited to 5,000 characters per
operation; dimensions to 1–10,000 canvas units; coordinates to ±1,000,000.
The command must fit within 3 MB (including transferred image data). Saved drawings retain the existing canvas
limits of 30,000 records and 5 MB of record JSON, with an 8 MiB room limit.
Use explicit `align`/`distribute` operations for layout; ordinary leaf edits do
not measure text or automatically fit containers.

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
  groups, frames and uploaded raster images are supported. See
  [image limits](mcp-files.md). Selected external images, videos, bookmarks, and
  embeds return `INVALID_CANVAS_PREVIEW`. Use `shapeIds` to select supported
  shapes on a mixed page. Pages are limited to 1000 shapes, including children.
- Rendering uses a detached snapshot and does not hold the canvas editing
  queue. The returned revision identifies that snapshot; newer edits can
  arrive while it renders. A preview does not create history or alter shapes.

The worker renders one preview or organization job at a time, admitting previews
before image decoding. Each job uses a fresh sandboxed Chromium process with no
network access beyond locally served renderer assets and fonts. Images are
returned directly and are not saved or published to a URL. A busy renderer,
timeout, missing browser, or oversized image returns `CANVAS_PREVIEW_UNAVAILABLE`;
retry after a short delay. Access is checked again before returning the image.

## Delete shapes

`delete_canvas_shapes` requires Full access and accepts `workspaceId`, `canvasId`,
`expectedRevision`, and `shapeIds` (up to 100 native IDs). Include connected arrows
in the same deletion batch when deleting their target nodes. Deleting an arrow
also removes its bindings. Nested leaf shapes can be deleted, but every affected
group must retain at least two direct children. A batch that would dissolve a
group is rejected in full; use `ungroup` in `edit_canvas` first when appropriate.
Frames may be left empty. Group/frame containers, unsupported shapes, and shapes
with a lock on themselves or any ancestor cannot be deleted through this tool.
The operation deletes drawings, not the page's canvas block.

## Conflicts, permissions, and history

| Permission | Allowed canvas operations |
| --- | --- |
| View only | Search library items, read current drawings and retained history, and preview current drawings. |
| View and edit | Also add canvas blocks, insert library items, create/update shapes and frames, connect nodes, group/ungroup, reparent, align and distribute. |
| Full access | Also delete shapes. |

Local Agent Auth requires an explicit workspace-scoped grant for each tool.
Workspace membership and content permissions still apply. Canvases attached to
archived pages cannot be read or edited through these tools.

`edit_canvas` and `delete_canvas_shapes` return `canvasId`, `revision`,
`createdShapes`, and `historyVersionId`. Library insertion returns the named
shape mapping described above. Each successful batch saves its previous drawing
in canvas history, which retains the latest 50 agent snapshots. Read an older drawing by
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

For library insertion and canvas organization, deploy the collaboration worker first, then
the web app/MCP. No database migration is required for this extension. Older
workers do not accept the new organization operations. Item versions prevent a worker
from silently inserting a different template than the one returned by search.
Existing drawings keep their stored records when the catalog changes.

For nested-shape editing, deploy the updated collaboration worker first, then
the web app/MCP. This extension needs no database migration. Older workers reject
nested edits and the new `create.parentId` field; existing top-level calls keep
working with the updated worker.

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
dependencies and prebuilds the browser bundle. For local workers and tests, install the browser once after
`bun install` (repeat after upgrading Playwright):

```sh
bunx --bun playwright install chromium --only-shell
```

On Linux, add `--with-deps` to install system dependencies. Supply
`NEXT_PUBLIC_TLDRAW_LICENSE_KEY` to the worker as well as the web app when using
a tldraw license. The browser and tldraw bundle run only in the collaboration
worker; the web app forwards authenticated requests. Browser startup has a
12-second cap within a 20-second deadline for queue wait, preparation, startup
and rendering. Cleanup has up to four more seconds, below the command bridge's
30-second request deadline. The worker verifies native layout and PNG export at
startup; `/health/renderer` reports this separately from collaboration health.
Monitor memory and the structured `canvas.browser.job` logs under preview and
organization load. Both use one shared queue with one active and two waiting
jobs, and a timed-out job retains its slot until cleanup finishes.

Follow the [collaboration deployment guide](collaboration.md#worker-deployment)
for worker configuration and the single-worker requirement.

Image insertion, reads, previews and file transport are covered in [MCP files](mcp-files.md).
