import type * as Y from "yjs";
import type { PageMeta } from "@/features/pages/schemas";

/** Shared Y.Map keys for the database state represented by the Yjs document. */
export const COLLAB_CONTENT_VERSION_KEY = "contentUpdatedAt";
export const COLLAB_SEEDED_KEY = "seeded";
export const COLLAB_SUBPAGE_LINKS_KEY = "haunter-subpage-links";

export const SUBPAGE_LINKED_COLLAB_EVENT = "pages.subpage-linked";

export type SubpageLinkedCollabEvent = {
	type: typeof SUBPAGE_LINKED_COLLAB_EVENT;
	child: Pick<PageMeta, "id" | "workspaceId">;
	parentContentUpdatedAt: string;
};

const UUID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isSameOrNewerContentVersion(
	next: string,
	current: string | null,
): boolean {
	if (!current) return true;
	const nextMs = Date.parse(next);
	const currentMs = Date.parse(current);
	return Number.isNaN(nextMs) || Number.isNaN(currentMs)
		? next >= current
		: nextMs >= currentMs;
}

export function createSubpageLinkedCollabEvent(
	child: Pick<PageMeta, "id" | "workspaceId">,
	parentContentUpdatedAt: string,
): SubpageLinkedCollabEvent {
	return {
		type: SUBPAGE_LINKED_COLLAB_EVENT,
		child: { id: child.id, workspaceId: child.workspaceId },
		parentContentUpdatedAt,
	};
}

export function isSubpageLinkedCollabEvent(
	value: unknown,
): value is SubpageLinkedCollabEvent {
	if (!value || typeof value !== "object") return false;
	const event = value as Partial<SubpageLinkedCollabEvent>;
	return (
		event.type === SUBPAGE_LINKED_COLLAB_EVENT &&
		Boolean(event.child) &&
		typeof event.child?.id === "string" &&
		UUID_PATTERN.test(event.child.id) &&
		typeof event.child.workspaceId === "string" &&
		event.child.workspaceId.length > 0 &&
		typeof event.parentContentUpdatedAt === "string" &&
		!Number.isNaN(Date.parse(event.parentContentUpdatedAt))
	);
}

/** Queue a durable subpage append instruction in an already-seeded Yjs doc. */
export function queueSubpageLinkInCollabDocument(
	doc: Y.Doc,
	child: Pick<PageMeta, "id" | "workspaceId">,
	parentContentUpdatedAt: string,
): boolean {
	const meta = doc.getMap<unknown>("haunter-meta");
	if (meta.get(COLLAB_SEEDED_KEY) !== true) return false;

	doc.transact(() => {
		doc
			.getMap<unknown>(COLLAB_SUBPAGE_LINKS_KEY)
			.set(
				child.id,
				createSubpageLinkedCollabEvent(child, parentContentUpdatedAt),
			);
		const current = meta.get(COLLAB_CONTENT_VERSION_KEY);
		if (
			typeof current !== "string" ||
			isSameOrNewerContentVersion(parentContentUpdatedAt, current)
		) {
			meta.set(COLLAB_CONTENT_VERSION_KEY, parentContentUpdatedAt);
		}
	});
	return true;
}
