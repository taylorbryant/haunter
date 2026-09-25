/** Browser-safe capability copy shared by approval UI use cases and adapters. */
export const AGENT_CAPABILITY_DESCRIPTIONS = {
	list_active_sessions:
		"List the acting user's recently reporting Haunter tabs in one authorized workspace, including page/canvas titles, focus, visibility, canvas selection counts and timestamps (Unix milliseconds). No other users' sessions. Choose an explicit sessionId; multiple tabs/devices can be present. Entries expire after two minutes without a heartbeat; stale means no heartbeat in 45 seconds. Background tabs retain their last selection. This is browser context, not saved document content or permission to edit.",
	get_active_context:
		"Read a specific Haunter sessionId from list_active_sessions in the same workspace. Returns pageId, active canvasId, its internal canvasPageId, selectedShapeIds, selectionCount, selectionComplete, sequence, capturedAt and lastSeenAt. capturedAt is when the context last changed, not the latest heartbeat. Do not assume a stale or ambiguous selection is the user's intended target. If selectionComplete is false, the IDs are truncated to 100; do not edit that partial selection as if complete. Resolve saved content and a revision with read_page/read_canvas, then use existing editing tools with explicit captured IDs. ACTIVE_SESSION_NOT_FOUND means rediscover sessions. Canvas textEditing identifies the rich-text shape being edited and its selection/caret. If absent, the browser does not report it; null means no rich-text edit. A null selection means the range is unavailable. selection.anchor/head/from/to are ProseMirror document positions, not plain-text offsets. Equal from/to is a caret; selectedText is capped at 2000 UTF-16 units with explicit truncated status. Browser text may be unsaved: verify the intended text against read_canvas before editing, and never use these positions directly as string offsets. Does not control the UI.",
	preview_canvas:
		"Render a read-only PNG of a canvas using tldraw. Returns an image plus revision, pageId, shapeIds, pixel dimensions and bounds in canvas coordinates. Optional expectedRevision checks the captured state; use the revision from edit_canvas to inspect that edit. Specify pageId for multi-page canvases. Optional shapeIds focuses on up to 100 shapes and their descendants; arrows must be selected explicitly. Light theme, opaque background, at most 1600 pixels per side. Pages are limited to 1000 shapes; images, videos, embeds and bookmarks cannot be previewed. Hosted MCP returns native image content; Agent Auth returns base64 image data. Requires the collaboration worker with Chromium installed.",
	create_canvas_block:
		"Create a canvas and append its block to a page atomically. Requires expectedRevision from read_page; returns the new page revision, block ID, canvasId and canvasRevision. Saves page history. Use edit_canvas to populate it.",
	read_canvas:
		"Read native canvas pages, shapes, text, positions, properties and arrow bindings with a revision token. Get canvasId from read_page blocks (props.canvasId). Optional historyVersionId reads one of the last 50 snapshots saved before agent edits; its revision is historical and cannot authorize a current write. Reads include available history IDs. Requires the collaboration worker.",
	edit_canvas:
		"Atomically create rectangles, ellipses, diamonds, text and notes; update unlocked top-level geo/text/note/arrow shapes; connect nodes with native bound arrows. Pass expectedRevision from read_canvas; on CANVAS_REVISION_CONFLICT reread. Create/connect ref names can be used by later operations in the same batch. Coordinates are canvas units. Geometry defaults to 240x120, text width to 240, notes have native fixed size. Text updates replace rich text with plain text. Omitted fields are preserved. No automatic text measurement or layout. Each successful batch saves canvas history. Up to 100 operations; requires the collaboration worker.",
	delete_canvas_shapes:
		"Delete unlocked supported top-level shapes atomically with expectedRevision from read_canvas. Include any arrows connected to a deleted node in shapeIds; arrow bindings are removed automatically. Requires Full access or an explicit scoped Agent Auth grant. Saves canvas history. On CANVAS_REVISION_CONFLICT reread before retrying.",
	list_workspaces:
		"List the workspaces the acting user belongs to, with their role in each. Call this first to get workspaceId values for the other capabilities.",
	list_workspace_members:
		"List the members of one workspace with user ids, names, emails, and roles. Use the returned userId as assigneeId when creating or updating tasks.",
	list_pages:
		"List every active page in one workspace as lightweight metadata, including hierarchy. Call list_workspaces first to get a workspaceId.",
	search_pages:
		"Full-text search across the pages of one workspace. Returns page ids and titles.",
	read_page:
		"Read a page with a body revision token. format defaults to markdown; use blocks for structured content with stable IDs, or both. Markdown is lossy for rich blocks: use blocks when editing existing content. Revision tokens cover saved state only.",
	edit_page_blocks:
		"Atomically update, insert, move, or delete page blocks by ID. Read the page first and pass its revision as expectedRevision; on REVISION_CONFLICT reread before retrying. Updates preserve omitted properties and children. Inserts assign IDs, use parentBlockId (omitted/null for root) and afterBlockId (null for beginning). Moves use blockId, parentBlockId (omitted/null for root), and afterBlockId (null for beginning), preserving IDs and the entire subtree, including canvas blocks. Moving the last child out of a nested parent is rejected to protect concurrent edits. Use moves for reordering instead of replace_page_content. Deleting a parent requires deleteChildren: true. Deletion requires Full access, or an active scoped replace_page_content grant for Agent Auth. Each successful batch saves a history snapshot. Common text blocks, task, callout, divider, and pageLink are editable; other rich blocks may be moved unchanged or explicitly deleted.",
	replace_page_content:
		"Replace the entire page body with Markdown or structured blocks, preserving page metadata. For reordering existing blocks, use the move operation in edit_page_blocks instead. Requires Full access and expectedRevision from read_page. Saves a history snapshot, reconciles tasks and links, and resets the document generation so old clients cannot merge replaced content back. Markdown creates new block IDs and cannot preserve rich content or task assignments; use structured blocks to retain IDs. Existing unsupported rich blocks must be supplied unchanged. An empty body is allowed. On REVISION_CONFLICT reread before retrying.",
	create_page:
		"Create a page in a workspace, optionally nested under another page and initialized from markdown. The page title is rendered separately above the body, so the markdown must contain body content only and must not repeat the page title as an opening heading. Call list_workspaces first to get a workspaceId.",
	append_to_page:
		"Append markdown content to the end of a page. Supports headings, paragraphs, bullet/numbered lists, task items (- [ ] title, optionally with a '(due: YYYY-MM-DD)' or '(due: YYYY-MM-DD HH:mm)' suffix), code fences, blockquotes (rendered as callouts), and dividers.",
	update_page:
		"Update a page's title, icon, or parent. Set icon to null to remove it or parentPageId to null to move the page to the workspace root.",
	archive_page:
		"Move a page and its descendants to the workspace trash. This is reversible and does not permanently delete content.",
	restore_page:
		"Restore an archived page and its descendants. If its former parent is unavailable, the page is restored at the workspace root.",
	list_tasks:
		"List tasks in one workspace. Defaults to open tasks assigned to the acting user; supports completion/scope filters, explicit due-date ranges, and timezone-aware overdue, today, or upcoming presets.",
	create_task:
		"Create a standalone task in a workspace. The task is assigned to the acting user by default; dueDate uses YYYY-MM-DD, optional dueTime uses HH:mm, and reminderOffsetMinutes may be 0, 15, 60, or 1440.",
	update_task:
		"Update a task's title, due date/time, reminder, or assignee. Set dueDate to null to clear the date, time, and reminder; set dueTime to null to keep the date without a time; set reminderOffsetMinutes to null to disable reminders. Page-backed task titles must still be edited in their page.",
	complete_task:
		"Mark a task complete. For a page-backed task, the source task block is checked too.",
	reopen_task:
		"Reopen a completed task. For a page-backed task, the source task block is unchecked too.",
	delete_task:
		"Permanently delete a standalone task. Page-backed tasks must be removed from their source page instead.",
} as const;

export function describeAgentCapability(name: string): string {
	return Object.hasOwn(AGENT_CAPABILITY_DESCRIPTIONS, name)
		? AGENT_CAPABILITY_DESCRIPTIONS[
				name as keyof typeof AGENT_CAPABILITY_DESCRIPTIONS
			]
		: "";
}
