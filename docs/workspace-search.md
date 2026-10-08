# Workspace search

Open Search with Cmd/Ctrl+K (or Cmd/Ctrl+Shift+K inside a host that uses that
shortcut). Search finds saved page titles and body text, task titles, canvas
titles, and text inside drawings. Use the All, Pages, Tasks, and Canvases filters
to narrow results. Type `>` to use the existing command menu.

Each result identifies its resource type and parent page where applicable.
Canvas matches include text boxes, notes, shape and arrow labels, and frame
names. Selecting a match opens the drawing, selects its matching shape, and
fits the camera to it. An embedded drawing opens within its parent page.
Task matches include completed and unassigned tasks and open a focused task
view with the appropriate filters.

## MCP

`search_workspace` uses the same workspace-scoped use case as the web and
embedded search menus. It requires View access or higher and an explicit
workspace grant in Agent Auth.

```json
{"workspaceId":"your-workspace-id","query":"launch","kind":"all","limit":20}
```

`kind` accepts `all`, `page`, `task`, or `canvas`; `limit` is 1–50. Queries
require 2–200 characters. The response contains `items` and `nextCursor`.
Pass the returned cursor with the same workspace, query, and kind to continue.
Titles rank ahead of content matches, followed by most recently edited first.
Pagination uses a deterministic keyset, rather than a fixed candidate cap.
Results can move if another user edits content between requests; this is a
live search, not a snapshot export.

Items include `kind`, `id`, `workspaceId`, `title`, `snippet`, `pageId`,
`pageTitle`, `shapeId`, `completed`, `updatedAt`, and a relative app `path`.
Use the item ID as `pageId` with `read_page`, as `canvasId` with `read_canvas`,
or as `taskId` with `list_tasks` (`filter: "all"`, `scope: "everyone"`).
There is one result per canvas, with its first matching shape. Existing
`search_pages` callers keep their current response format.

## Storage and release

Run migration `0049_cool_kate_bishop.sql` before deploying the web app. It adds
`canvases.search_content`, backfills existing drawings, and installs insert/update
triggers that regenerate the text projection whenever a snapshot is saved.
This also covers writes from an older collaboration worker during rollout.
It does not change snapshots, history, or edit timestamps. The initial backfill
scans existing snapshots, so account for database write time when scheduling it.

Search queries read the text projection; they do not launch Chromium or fetch
images. The projection contains only visible drawing text and shape IDs,
excluding geometry, asset URLs, metadata, and camera state. Page search reuses
the existing body text projection, with a fallback for older unprojected pages.

The shared UI refreshes after relevant workspace events and local edits,
refetches when searching again, and polls while open to cover missed events.
Archived pages, their tasks and drawings, and retained drawings whose page
block was removed are excluded. Every request enforces current workspace access;
document-only embedded sessions cannot search the whole workspace.

This first version uses literal substring matching (ASCII case-insensitive,
non-ASCII case-sensitive, following SQLite LIKE). It does not search image
pixels, file contents, archived content, or historical versions. A canvas
preview thumbnail is not generated as part of search.
