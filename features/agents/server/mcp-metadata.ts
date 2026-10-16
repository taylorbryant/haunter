import "@beignet/core/server-only";
import { ghostSvgDataUri } from "@/lib/ghost-mark";
import {
	agentCapabilityLabel,
	type HaunterAgentCapability,
} from "../permission-profiles";

export const haunterMcpIcons = [
	{
		src: ghostSvgDataUri(24),
		mimeType: "image/svg+xml",
		sizes: ["any"],
		theme: "light" as const,
	},
	{
		src: ghostSvgDataUri(24, "#ffffff"),
		mimeType: "image/svg+xml",
		sizes: ["any"],
		theme: "dark" as const,
	},
];

export function mcpInvocationMeta(invoking: string, invoked: string) {
	return {
		"openai/toolInvocation/invoking": invoking,
		"openai/toolInvocation/invoked": invoked,
	};
}

// Keep progress copy explicit: permission labels describe access, while these
// describe a single tool call. Exhaustive keys keep new tools from missing copy.
const capabilityStatuses = {
	list_canvases: ["Finding canvases…", "Canvases listed"],
	create_canvas: ["Creating canvas…", "Canvas created"],
	update_canvas: ["Updating canvas…", "Canvas updated"],
	delete_canvas: ["Deleting canvas…", "Canvas deleted"],
	list_canvas_favorites: [
		"Finding favorite canvases…",
		"Favorite canvases listed",
	],
	set_canvas_favorite: ["Updating canvas favorite…", "Canvas favorite updated"],
	list_page_favorites: ["Finding favorite pages…", "Favorite pages listed"],
	set_page_favorite: ["Updating page favorite…", "Page favorite updated"],
	list_backlinks: ["Finding backlinks…", "Backlinks listed"],
	list_trash: ["Browsing trash…", "Trash listed"],
	list_page_versions: ["Loading page history…", "Page history loaded"],
	read_page_version: ["Reading saved version…", "Saved version read"],
	restore_page_version: ["Restoring page version…", "Page version restored"],
	list_active_sessions: ["Finding active sessions…", "Active sessions listed"],
	get_active_context: ["Reading current context…", "Current context read"],
	create_canvas_block: ["Adding canvas block…", "Canvas block added"],
	search_canvas_library: [
		"Searching canvas library…",
		"Canvas library searched",
	],
	insert_canvas_library_item: [
		"Inserting library item…",
		"Library item inserted",
	],
	restore_canvas_version: [
		"Restoring canvas version…",
		"Canvas version restored",
	],
	read_canvas: ["Reading canvas…", "Canvas read"],
	read_canvas_image: ["Reading canvas image…", "Canvas image read"],
	insert_canvas_image: ["Adding canvas image…", "Canvas image added"],
	attach_file_to_page: ["Attaching file…", "File attached"],
	preview_canvas: ["Rendering canvas preview…", "Canvas preview ready"],
	edit_canvas: ["Editing canvas…", "Canvas edited"],
	delete_canvas_shapes: ["Deleting canvas shapes…", "Canvas shapes deleted"],
	list_workspaces: ["Finding workspaces…", "Workspaces listed"],
	list_workspace_members: [
		"Finding workspace members…",
		"Workspace members listed",
	],
	list_pages: ["Finding pages…", "Pages listed"],
	search_workspace: ["Searching workspace…", "Workspace searched"],
	search_pages: ["Searching pages…", "Pages searched"],
	read_page: ["Reading page…", "Page read"],
	list_page_attachments: [
		"Finding page attachments…",
		"Page attachments listed",
	],
	read_page_attachment: ["Reading page attachment…", "Page attachment read"],
	list_tasks: ["Finding tasks…", "Tasks listed"],
	create_page: ["Creating page…", "Page created"],
	append_to_page: ["Adding to page…", "Content added"],
	edit_page_blocks: ["Editing page blocks…", "Page blocks edited"],
	replace_page_content: ["Replacing page content…", "Page content replaced"],
	update_page: ["Updating page…", "Page updated"],
	create_task: ["Creating task…", "Task created"],
	update_task: ["Updating task…", "Task updated"],
	complete_task: ["Completing task…", "Task completed"],
	reopen_task: ["Reopening task…", "Task reopened"],
	archive_page: ["Moving page to trash…", "Page moved to trash"],
	restore_page: ["Restoring page…", "Page restored"],
	delete_task: ["Deleting task…", "Task deleted"],
} satisfies Record<HaunterAgentCapability, [string, string]>;

export function agentMcpMetadata(capability: HaunterAgentCapability) {
	return {
		title: agentCapabilityLabel(capability),
		_meta: mcpInvocationMeta(...capabilityStatuses[capability]),
	};
}
