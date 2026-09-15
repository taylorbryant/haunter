import type { z } from "zod";
import {
	WorkspaceCanvasEventSchema,
	WorkspaceEventSchema,
	WorkspacePageEventSchema,
	WorkspaceTaskEventSchema,
} from "./schemas";

export const WORKSPACE_EVENT_SCHEMA_VERSION = 1 as const;
export type WorkspacePageEvent = z.infer<typeof WorkspacePageEventSchema>;
export type WorkspaceTaskEvent = z.infer<typeof WorkspaceTaskEventSchema>;
export type WorkspaceCanvasEvent = z.infer<typeof WorkspaceCanvasEventSchema>;
export type WorkspaceEvent = z.infer<typeof WorkspaceEventSchema>;

export function createWorkspacePageEvent(input: {
	type: WorkspacePageEvent["type"];
	workspaceId: string;
	pageId: string;
	affectedPageIds?: readonly string[];
	occurredAt?: string;
}): WorkspacePageEvent {
	const affectedPageIds = input.affectedPageIds
		? [...new Set([input.pageId, ...input.affectedPageIds])]
		: undefined;
	return {
		schemaVersion: WORKSPACE_EVENT_SCHEMA_VERSION,
		type: input.type,
		workspaceId: input.workspaceId,
		pageId: input.pageId,
		...(affectedPageIds ? { affectedPageIds } : {}),
		occurredAt: input.occurredAt ?? new Date().toISOString(),
	} as WorkspacePageEvent;
}

export function createWorkspaceTaskEvent(input: {
	workspaceId: string;
	taskId: string;
	occurredAt?: string;
}): WorkspaceTaskEvent {
	return {
		schemaVersion: WORKSPACE_EVENT_SCHEMA_VERSION,
		type: "task.changed",
		workspaceId: input.workspaceId,
		taskId: input.taskId,
		occurredAt: input.occurredAt ?? new Date().toISOString(),
	};
}

export function createWorkspaceCanvasEvent(input: {
	workspaceId: string;
	canvasId: string;
	pageId: string | null;
	occurredAt?: string;
}): WorkspaceCanvasEvent {
	return {
		schemaVersion: WORKSPACE_EVENT_SCHEMA_VERSION,
		type: "canvas.changed",
		workspaceId: input.workspaceId,
		canvasId: input.canvasId,
		pageId: input.pageId,
		occurredAt: input.occurredAt ?? new Date().toISOString(),
	};
}

export function workspaceEventAffectedPageIds(
	event: WorkspacePageEvent,
): string[] {
	return [...new Set([event.pageId, ...(event.affectedPageIds ?? [])])];
}

export function workspaceEventRemovesPage(
	event: WorkspacePageEvent,
	pageId: string,
): boolean {
	return (
		(event.type === "page.trashed" || event.type === "page.purged") &&
		workspaceEventAffectedPageIds(event).includes(pageId)
	);
}

export const isWorkspaceEvent = (value: unknown): value is WorkspaceEvent =>
	WorkspaceEventSchema.safeParse(value).success;
export const isWorkspacePageEvent = (
	value: unknown,
): value is WorkspacePageEvent =>
	WorkspacePageEventSchema.safeParse(value).success;
export const isWorkspaceTaskEvent = (
	value: unknown,
): value is WorkspaceTaskEvent =>
	WorkspaceTaskEventSchema.safeParse(value).success;
export const isWorkspaceCanvasEvent = (
	value: unknown,
): value is WorkspaceCanvasEvent =>
	WorkspaceCanvasEventSchema.safeParse(value).success;
