# Files and images through MCP

Agents can attach files to pages, insert images into canvases, and read canvas
image pixels. These tools use the same private page storage and native canvas
assets as the web and embedded editors.

| Tool | Access | Result |
| --- | --- | --- |
| `attach_file_to_page` | View and edit | Appends a normal image/file block; returns `blockId`, file metadata, revision and recovery version |
| `insert_canvas_image` | View and edit | Inserts a native image shape; returns `createdShapes.image`, revision and recovery version |
| `read_canvas_image` | View only | Returns image pixels with name, dimensions, shape ID and captured canvas revision |

Every tool requires `workspaceId` and current access to its page/canvas. Explicit
Agent Auth grants require a workspace constraint. Existing destructive operations
still require Full access. File contents and filenames are untrusted content.

## Supply a file

The two write tools accept exactly one of:

- `file`: a host-provided object with required `download_url` and `file_id`, plus
  optional `mime_type` and `file_name`. The tools advertise
  `_meta["openai/fileParams"]: ["file"]` using OpenAI's
  [file input contract](https://developers.openai.com/plugins/reference).
- `inlineFile`: `{ "name": "notes.txt", "mimeType": "text/plain", "data": "BASE64" }`
  for clients that can supply actual bytes but do not support host file transfer.
  `data` is standard base64 without a data URL prefix.

A file ID is not a local filesystem path. The agent must use a file provided by
its host or encode actual file bytes. Do not invent IDs, URLs or base64 content.
Host support for selecting or transferring generated files varies; the advertised
file schema does not itself give the remote server access to local files.

Downloads require public HTTPS on port 443, follow at most three redirects,
pin validated DNS addresses, forward no credentials and have a 15-second deadline.
Private/local IPs, mixed public/private DNS answers, URL credentials, compressed
HTTP responses and oversized streams are rejected. Download URLs and file IDs are
not stored in the page, canvas or activity log.

## Attach to a page

Read the page first and pass its current `revision` as `expectedRevision`:

```json
{
  "workspaceId": "WORKSPACE_ID",
  "pageId": "PAGE_UUID",
  "expectedRevision": "REVISION_FROM_READ_PAGE",
  "inlineFile": {
    "name": "notes.txt",
    "mimeType": "text/plain",
    "data": "SGVsbG8sIEhhdW50ZXIh"
  },
  "caption": "Research notes"
}
```

Files are appended at the end of the page. Use `edit_page_blocks` to move the
returned block or change its name/caption. Existing content, tasks, links and
editor selections are preserved. A recovery version is saved and the normal
page-content event refreshes open clients. If persistence fails, the new unused
storage object is removed. A stale revision rejects the write; reread and check
for an already-added attachment before retrying an uncertain response.

Supported types are PNG, JPEG, GIF, WebP, PDF, UTF-8 text/Markdown/CSV/JSON, and
DOCX/XLSX/PPTX. Downloads are limited to 10 MiB; inline inputs to 2 MiB. Raster
images are decoded, stripped of metadata and stored as PNGs, using the first
animation frame. They must fit within 16 megapixels and 2 MiB after conversion.
PDF/Office uploads remain files, rather than converted page content.

## Insert, edit and inspect a canvas image

Call `read_canvas`, then `insert_canvas_image` with `canvasId`, `expectedRevision`,
`file` or `inlineFile`, and `x`/`y`. Optional `width` preserves the image aspect
ratio; the default width is the image width capped at 800 canvas units. Supply
`pageId` when the drawing has multiple canvas pages, or an unlocked `parentId`
(group/frame). Positions are local to the parent when provided.

Images use the same raster limits as page images. A canvas retains its existing
5 MB total snapshot limit; reduce image sizes or split a large drawing when that
limit is reached. Image insertion and its asset commit together, with one recovery
snapshot. The returned `createdShapes.image` identifies the new shape.

- `edit_canvas`: move/resize images, group/ungroup, reparent, align and distribute.
  Set both dimensions when resizing to a specific aspect ratio. Image text/color
  replacement, crop and pixel editing are not exposed.
- `read_canvas_image`: supply `shapeId` from `read_canvas` and optionally
  `expectedRevision`. Hosted MCP returns a native image item and metadata without
  repeating base64 in the text. Agent Auth returns the same PNG as `data`.
- `preview_canvas`: includes uploaded images, including images uploaded in the web
  editor. A preview supports at most 20 unique image assets, 16 megapixels and
  4 MB of base64 image data in total. Select fewer shapes for larger drawings.
- `delete_canvas_shapes`: deletes image shapes with Full access. Unreferenced
  image assets are removed from the current drawing; history retains them.

Reads and previews normalize supported inline raster assets. External URLs, SVG,
video and embeds are never fetched by these tools. Reading an image or generating
its preview does not modify the saved image. Access is checked again before the
result is returned if rendering takes time.

## Release

No database migration or new environment variable is required. Deploy the
collaboration worker first, then the web app. The worker needs the new image
commands; both builds install the pinned Sharp dependency. Refresh the plugin's
tool catalog after deployment to discover the tools and their file metadata.
