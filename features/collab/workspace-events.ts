export const WORKSPACE_EVENT_SCHEMA_VERSION = 1 as const;

type WorkspaceEventBase = {
	schemaVersion: typeof WORKSPACE_EVENT_SCHEMA_VERSION;
	workspaceId: string;
	occurredAt: string;
};

type WorkspacePageEventBase = WorkspaceEventBase & {
	pageId: string;
	/** Every page whose direct SQLite projection changed. */
	affectedPageIds?: string[];
};

export type WorkspacePageEvent = WorkspacePageEventBase &
	(
		| { type: "page.created" }
		| { type: "page.renamed" }
		| { type: "page.contentChanged" }
		| { type: "page.moved" }
		| { type: "page.iconChanged" }
		| { type: "page.trashed" }
		| { type: "page.restored" }
		| { type: "page.purged" }
	);

export type WorkspaceTaskEvent = WorkspaceEventBase & {
	type: "task.changed";
	taskId: string;
};

export type WorkspaceCanvasEvent = WorkspaceEventBase & {
	type: "canvas.changed";
	canvasId: string;
	pageId: string;
};

export type WorkspaceEvent =
	| WorkspacePageEvent
	| WorkspaceTaskEvent
	| WorkspaceCanvasEvent;

/** Ephemeral invalidation hints only. SQLite remains authoritative. */
export type WorkspaceEventPublisherPort = {
	publish(event: WorkspaceEvent): Promise<void>;
};

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
	pageId: string;
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

function isEventBase(value: unknown): value is Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return false;
	}
	const event = value as Record<string, unknown>;
	return (
		event.schemaVersion === WORKSPACE_EVENT_SCHEMA_VERSION &&
		typeof event.workspaceId === "string" &&
		event.workspaceId.length > 0 &&
		typeof event.occurredAt === "string"
	);
}

export function isWorkspacePageEvent(
	value: unknown,
): value is WorkspacePageEvent {
	if (!isEventBase(value)) return false;
	const event = value as Record<string, unknown>;
	const affectedPageIds = event.affectedPageIds;
	return (
		typeof event.pageId === "string" &&
		event.pageId.length > 0 &&
		(affectedPageIds === undefined ||
			(Array.isArray(affectedPageIds) &&
				affectedPageIds.length > 0 &&
				affectedPageIds.every(
					(pageId) => typeof pageId === "string" && pageId.length > 0,
				))) &&
		(event.type === "page.created" ||
			event.type === "page.renamed" ||
			event.type === "page.contentChanged" ||
			event.type === "page.moved" ||
			event.type === "page.iconChanged" ||
			event.type === "page.trashed" ||
			event.type === "page.restored" ||
			event.type === "page.purged")
	);
}

export function isWorkspaceTaskEvent(
	value: unknown,
): value is WorkspaceTaskEvent {
	if (!isEventBase(value)) return false;
	const event = value as Record<string, unknown>;
	return (
		event.type === "task.changed" &&
		typeof event.taskId === "string" &&
		event.taskId.length > 0
	);
}

export function isWorkspaceCanvasEvent(
	value: unknown,
): value is WorkspaceCanvasEvent {
	if (!isEventBase(value)) return false;
	const event = value as Record<string, unknown>;
	return (
		event.type === "canvas.changed" &&
		typeof event.canvasId === "string" &&
		event.canvasId.length > 0 &&
		typeof event.pageId === "string" &&
		event.pageId.length > 0
	);
}

export function isWorkspaceEvent(value: unknown): value is WorkspaceEvent {
	return (
		isWorkspacePageEvent(value) ||
		isWorkspaceTaskEvent(value) ||
		isWorkspaceCanvasEvent(value)
	);
}
