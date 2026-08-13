/** Browser-safe capability copy shared by approval UI use cases and adapters. */
export const AGENT_CAPABILITY_DESCRIPTIONS = {
	list_workspaces:
		"List the workspaces the acting user belongs to, with their role in each. Call this first to get workspaceId values for the other capabilities.",
	list_workspace_members:
		"List the members of one workspace with user ids, names, emails, and roles. Use the returned userId as assigneeId when creating or updating tasks.",
	list_pages:
		"List every active page in one workspace as lightweight metadata, including hierarchy. Call list_workspaces first to get a workspaceId.",
	search_pages:
		"Full-text search across the pages of one workspace. Returns page ids and titles.",
	read_page: "Read a page as markdown.",
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
