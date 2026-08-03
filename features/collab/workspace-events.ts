export const WORKSPACE_EVENT_SCHEMA_VERSION = 1 as const;

type WorkspacePageEventBase = {
	schemaVersion: typeof WORKSPACE_EVENT_SCHEMA_VERSION;
	workspaceId: string;
	pageId: string;
	/** Every page whose direct projection changed. Subtree mutations include
	 * descendants so an already-open child can be invalidated immediately. */
	affectedPageIds?: string[];
	occurredAt: string;
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

/** Server-side transport for ephemeral workspace invalidation hints. SQLite
 * remains authoritative; consumers always refetch instead of trusting event
 * payloads as durable state. */
export type WorkspaceEventPublisherPort = {
	publish(event: WorkspacePageEvent): Promise<void>;
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

/** Broadcast events cross a network boundary, so narrow the Liveblocks JSON
 * value before it is allowed to trigger cache invalidation. */
export function isWorkspacePageEvent(
	value: unknown,
): value is WorkspacePageEvent {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return false;
	}
	const event = value as Record<string, unknown>;
	const affectedPageIds = event.affectedPageIds;
	return (
		event.schemaVersion === WORKSPACE_EVENT_SCHEMA_VERSION &&
		typeof event.workspaceId === "string" &&
		event.workspaceId.length > 0 &&
		typeof event.pageId === "string" &&
		event.pageId.length > 0 &&
		typeof event.occurredAt === "string" &&
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
