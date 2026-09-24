# Edit pages through MCP

Use `read_page` to get the page body and its revision, then send that revision
with `edit_page_blocks` or `replace_page_content`. Both writes save a history
snapshot and update embedded tasks, backlinks, and search results in the same
transaction. Each request needs a `workspaceId` from `list_workspaces` and a
`pageId` from `list_pages` or `search_pages`.

## Read the body

`read_page` accepts `format: "markdown" | "blocks" | "both"`. The default is
`markdown`, which preserves the existing Markdown response. Every format
returns `pageId`, `title`, `updatedAt`, and `revision`; `blocks` and `markdown`
are included according to the requested format.

```json
{
  "workspaceId": "YOUR_WORKSPACE_ID",
  "pageId": "YOUR_PAGE_ID",
  "format": "blocks"
}
```

Blocks have stable `id` values, a `type`, `props`, optional `content`, and nested
`children`. Keep IDs when editing existing blocks. Treat `revision` as an opaque
token. Renaming or moving the page does not change its body revision.

Markdown omits tables and canvases and cannot preserve all task properties.
Use structured blocks to inspect existing content before editing it.

## Edit selected blocks

Pass an ordered `operations` array to `edit_page_blocks`. This example changes
one paragraph and inserts another immediately after it:

```json
{
  "workspaceId": "YOUR_WORKSPACE_ID",
  "pageId": "YOUR_PAGE_ID",
  "expectedRevision": "REVISION_FROM_READ_PAGE",
  "operations": [
    {
      "op": "update",
      "blockId": "EXISTING_BLOCK_ID",
      "content": [{ "type": "text", "text": "Launch on Monday.", "styles": {} }]
    },
    {
      "op": "insert",
      "afterBlockId": "EXISTING_BLOCK_ID",
      "blocks": [
        {
          "type": "paragraph",
          "content": [{ "type": "text", "text": "Confirm support coverage.", "styles": {} }]
        }
      ]
    }
  ]
}
```

| Operation | Fields and behavior |
| --- | --- |
| `update` | Requires `blockId` and at least one of `content` or `props`. Supplied content replaces the block's inline content. Properties are merged by key. Omitted content/properties and all child blocks are preserved. Block type and ID cannot be changed. |
| `insert` | Requires `afterBlockId` and a nonempty `blocks` array. Omit `parentBlockId` or set it to `null` for the page root; otherwise specify the parent block. `afterBlockId: null` inserts at the beginning of that parent's children. A non-null anchor must be a direct child of that parent. New blocks accept `type`, optional `props`, and optional `content`; the server assigns IDs. |
| `move` | Requires `blockId` and `afterBlockId`. Uses the same destination fields as `insert`: `parentBlockId` omitted/null means the page root and `afterBlockId: null` means the beginning. Moves the existing block and all its children, preserving IDs, properties, rich content, and canvas references. The anchor must belong to the destination parent. Moving into the block's own subtree or using itself as the anchor is invalid. |
| `delete` | Requires `blockId`. If it has children, also set `deleteChildren: true` to explicitly remove its subtree. Deleting the final body block leaves an empty paragraph. |

Editable and insertable types are `paragraph`, `heading`, `bulletListItem`,
`numberedListItem`, `task`, `codeBlock`, `callout`, `quote`, `divider`, and
`pageLink`. Inline content supports text with styles, links containing text, and
page mentions. `divider` and `pageLink` accept no inline content. Unsupported
types, invalid properties, and missing IDs fail the entire batch.
Moves also support existing rich blocks such as canvases and tables, without
changing their content. Moving a parent includes its entire subtree. Moves need
View and edit access and do not require the deletion grant.
Code blocks accept only unstyled text entries; links, mentions, and text styles
are rejected. Numbered list items support a numeric `start` property.

Use task properties `checked`, `due` (YYYY-MM-DD), `dueTime` (HH:mm), `reminder`
(a string containing 0, 15, 60, or 1440 minutes), and `assignee` (a workspace
member's user ID). Empty strings clear optional task properties. Changing a task
block's text preserves its task ID; deleting the block removes the derived task.

Each batch allows at most 100 operations, each insertion allows at most 1,000
blocks, and the complete batch must be at most 5 MB. New blocks cannot declare
IDs or nested children. Use a later call with the returned IDs to insert children.

To swap two adjacent canvas blocks, move the first after the second:

```json
{
  "workspaceId": "YOUR_WORKSPACE_ID",
  "pageId": "YOUR_PAGE_ID",
  "expectedRevision": "REVISION_FROM_READ_PAGE",
  "operations": [
    { "op": "move", "blockId": "FIRST_CANVAS_BLOCK_ID", "afterBlockId": "SECOND_CANVAS_BLOCK_ID" }
  ]
}
```

Use the page block IDs from `read_page`, not the `canvasId` values. A move keeps
the current document generation, so open editors receive the reordered blocks
without a page-replacement recovery notice. It returns no new block IDs.
Moving the last child out of a nested parent is rejected: removing its child
container could discard a concurrent sibling insertion. Leave another child in
that parent before moving the block. Root-level reorders have no such restriction.
Rich blocks can be moved, but their content cannot be edited with this tool.

## Replace the entire body

Use `replace_page_content` for a complete rewrite or an agent-maintained report:

```json
{
  "workspaceId": "YOUR_WORKSPACE_ID",
  "pageId": "YOUR_PAGE_ID",
  "expectedRevision": "REVISION_FROM_READ_PAGE",
  "content": {
    "format": "markdown",
    "markdown": "## Overview\n\nThe revised plan…"
  }
}
```

Alternatively pass `content: { "format": "blocks", "blocks": [...] }` using
structured blocks with unique IDs and `children` arrays. Existing rich blocks
that cannot be edited through this API must be supplied unchanged if retained;
new or modified rich blocks are rejected. Markdown replacement creates new IDs,
so it recreates embedded tasks and does not retain their previous assignments or
reminders. Structured replacement preserves task associations when IDs are kept.

Replacement retains page metadata, including title, icon, and parent. Empty
Markdown or an empty block array clears the body to an empty paragraph. Markdown
accepts at most 100,000 characters. Structured bodies must fit the page limits:
5 MB, 10,000 blocks, and 64 block levels; the saved collaborative document must
also fit its 8 MiB limit.

## Results, permissions, and conflicts

Both writes return `pageId`, `title`, `updatedAt`, `revision`, `historyVersionId`,
`insertedBlockIds`, `tasksChanged`, and `linksChanged`. Insertion IDs are returned
in operation order. Replacement returns an empty insertion list; read the page
again for its new structure. Restore a snapshot through the page's version
history. History retains the latest 50 snapshots, including ordinary checkpoints.

| Permission | Allowed operations |
| --- | --- |
| View only | Read any supported format. |
| View and edit | Update and insert blocks. |
| Full access | Also delete blocks and replace bodies. |

Workspace membership and page permissions are checked on every call. For local
Agent Auth, each tool requires its own workspace-scoped grant. Delete operations
inside `edit_page_blocks` additionally require an effective `replace_page_content`
grant covering the same workspace and page. Resource constraints support exact
values and `eq`, `in`, and `not_in`; other constraints deny deletion.

A batch with a forbidden deletion fails without applying its other operations.
All validation errors roll back content, history, tasks, and backlinks together.

On a stale revision, the hosted MCP response has `isError: true` and a JSON text
payload containing `code: "REVISION_CONFLICT"`, `message`, and `currentRevision`.
Read the page again and reconsider the edits before retrying. A repeated request
using the old revision cannot apply the same batch twice.

Revisions describe saved state. Targeted edits merge through the collaboration
system and preserve concurrent changes to untouched blocks. Simultaneous edits
to the same text can still merge and should be reviewed. Full replacement starts
a new document generation: open editors reload it, and unsaved edits from older
sessions are retained for recovery instead of merging into the replacement.
Moves reinsert the addressed subtree in the collaborative document. Concurrent
edits to other blocks are preserved; pending edits inside the moved subtree may
not follow the move, just as with dragging blocks in the editor. Sync those edits
before moving their block.
Concurrent moves that produce identical copies are reconciled to one placement
before broadcast or persistence. A conflict with different content, or one that
would empty a nested container or remove another block, is rejected without
overwriting the saved page.
Keep the affected editor open and download its drafts before resolving the conflict.

After a replacement or history restore, the editor identifies which action
created the current page and keeps earlier browser copies available for recovery.
Dismiss notice hides the expanded message without deleting any copies; use
Previous copies to reopen it and download one. A later reset with a new recovery
copy shows the notice again. Older documents without action metadata use a
neutral recovery message.
