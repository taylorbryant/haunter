# Manage Haunter content through MCP

These tools are available to the model through hosted MCP and to delegated
agents through Agent Auth. Every call requires a `workspaceId` from
`list_workspaces`. Workspace membership and resource permissions are checked
again on execution, using the same use cases as the web app.

| Tools | Minimum hosted MCP profile | Behavior |
| --- | --- | --- |
| `list_canvases` | View only | List standalone canvas metadata. |
| `create_canvas`, `update_canvas` | View and edit | Create an empty standalone canvas or rename one. |
| `delete_canvas` | Full access | Permanently delete a standalone canvas, including its drawing and history. |
| `list_page_favorites`, `list_canvas_favorites` | View only | List the acting user's favorites in the workspace. |
| `set_page_favorite`, `set_canvas_favorite` | View and edit | Set or clear the acting user's favorite with `favorite: true` or `false`. |
| `list_backlinks` | View only | Find active pages containing links or mentions of a page. |
| `list_trash` | View only | List archived page subtree roots and their deletion times. |
| `list_page_versions`, `read_page_version` | View only | Browse retained page history and inspect saved bodies. |
| `restore_page_version` | Full access | Restore a saved page body with a current revision precondition. |
| `restore_canvas_version` | Full access | Restore a retained drawing with a current revision precondition and a recovery snapshot. See [canvas restoration](./mcp-canvas-editing.md#restore-a-saved-canvas-version). |

## Standalone canvases and favorites

`create_canvas` takes a `title` and returns `canvasId`. Use that ID with
`open_haunter_canvas` to open the canvas, or `read_canvas` followed by
`edit_canvas` to draw. `update_canvas` takes `canvasId` and `title`.
Drawing operations are documented in the [canvas editing API](mcp-canvas-editing.md).

Standalone management does not modify canvases embedded inside pages.
Use `read_page` with `format: "blocks"` to discover those canvas IDs and
`create_canvas_block` to add one. Inline canvas blocks are managed through
their parent page. Standalone deletion is permanent; it has no trash recovery.

Favorite tools take `pageId` or `canvasId`. They modify personal navigation,
not shared page content. They never read or change another user's favorites.
Archived pages are excluded from favorites until restored.

With workspace live updates enabled, successful favorite changes refresh the
acting user's open web and embedded panels. Other members do not receive those
personal hints. Reopen older panels after deployment to enable this refresh;
the regular navigation polling remains available as a fallback.

## Trash and backlinks

`list_backlinks` takes `pageId`; returned pages can be inspected with `read_page`.
Archived source pages are excluded. `list_trash` returns subtree roots, so
children are not listed separately while their parent is also in trash.
Use the existing Full-access `restore_page` tool to recover a root and its
descendants. Permanent trash purging remains human-controlled.

## Restore a page version

1. Call `list_page_versions` with `pageId` to find a retained `versionId`.
2. Call `read_page_version` with both IDs to inspect it. `format` accepts
   `markdown` (default), `blocks`, or `both`. Use blocks for rich content.
3. Call `read_page` to inspect the current body and obtain its `revision`.
4. Call `restore_page_version` with `pageId`, `versionId`, and that token as
   `expectedRevision`.
5. Read the page again for its new revision before making another edit.

A restoration checks the revision inside the write transaction. A stale token
returns `REVISION_CONFLICT` with `currentRevision`; reread and reconsider before
retrying. It saves the body being replaced as a recovery snapshot and reconciles
embedded tasks and backlinks. History retains the latest 50 snapshots.
With live updates enabled, the page-content event also refreshes an open history
panel so the new recovery snapshot appears without closing and reopening it.

Restoration replaces the body, including rich blocks, while retaining the
current title, icon, and hierarchy. Canvas blocks retain canvas references;
the drawings themselves are not rolled back. A new collaborative document
generation keeps old clients' unsaved drafts from merging into the restored
body. Those drafts remain available for recovery through the existing editor.
Archived pages must first be recovered with `restore_page`.

## Release and grants

These tools require a web/MCP server deployment and no new database migration.
For `restore_canvas_version`, deploy the updated collaboration worker first.
Standalone metadata and favorites do not use the collaboration worker.

Refresh the plugin's tool discovery after deployment if the new tools do not
appear. Hosted connections gain tools within their existing permission profile;
View and edit connections cannot restore versions or delete canvases. Agent
Auth requires an explicit grant for each new capability, constrained by
`workspaceId`. Broader grants without that required constraint are rejected.
Account security, permission administration, and permanent trash purging remain
outside this tool batch.
