import type { QueryFilters } from "@tanstack/react-query";
import { rq } from "@/client";
import { isPageAgentActivity } from "@/features/agents/page-activity";
import {
	getCanvas,
	getCanvasNavigation,
	listCanvases,
} from "@/features/canvases/contracts";
import { listNotifications } from "@/features/notifications/contracts";
import {
	getPage,
	getPageMetadata,
	getPageNavigation,
	listBacklinks,
	listPages,
	listTrash,
	searchPages,
} from "@/features/pages/contracts";
import { listTasks } from "@/features/tasks/contracts";
import {
	isWorkspaceCanvasEvent,
	isWorkspaceTaskEvent,
	type WorkspaceEvent,
	workspaceEventAffectedPageIds,
} from "../workspace-events";

function taskQueries(workspaceId: string): QueryFilters[] {
	return [
		rq(listTasks).filter({ path: { workspaceId } }),
		rq(listNotifications).filter(),
	];
}
function pageQueries(workspaceId: string): QueryFilters[] {
	return [
		rq(listPages).filter({ path: { workspaceId } }),
		rq(getPageNavigation).filter({ path: { workspaceId } }),
		rq(listTrash).filter({ path: { workspaceId } }),
		// Search and incoming links may include pages from other workspaces.
		rq(searchPages).filter(),
		rq(listBacklinks).filter(),
		...taskQueries(workspaceId),
	];
}
function canvasQueries(workspaceId: string): QueryFilters[] {
	return [
		rq(listCanvases).filter({ path: { workspaceId } }),
		rq(getCanvasNavigation).filter({ path: { workspaceId } }),
	];
}
export function workspaceReconciliationQueries(
	workspaceId: string,
): QueryFilters[] {
	return [
		...pageQueries(workspaceId),
		...canvasQueries(workspaceId),
		rq(getPage).filter(),
		rq(getPageMetadata).filter(),
		rq(getCanvas).filter(),
	];
}
export function workspaceEventQueries(
	workspaceId: string,
	event: WorkspaceEvent,
): QueryFilters[] {
	if (event.workspaceId !== workspaceId) return [];
	if (isPageAgentActivity(event)) return [];
	if (isWorkspaceTaskEvent(event)) return taskQueries(workspaceId);
	if (isWorkspaceCanvasEvent(event))
		return [
			...canvasQueries(workspaceId),
			rq(getCanvas).filter({ path: { id: event.canvasId } }),
		];
	return [
		...pageQueries(workspaceId),
		...workspaceEventAffectedPageIds(event).flatMap((id) => [
			rq(getPage).filter({ path: { id } }),
			rq(getPageMetadata).filter({ path: { id } }),
		]),
	];
}
