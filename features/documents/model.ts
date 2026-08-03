import type * as Y from "yjs";

export const DOCUMENT_SCHEMA_VERSION = 1;
export const PAGE_FRAGMENT_NAME = "blocknote";
export const PAGE_TITLE_NAME = "title";
export const PAGE_META_NAME = "haunter-meta";
export const PAGE_ACTIVE_GENERATION_KEY = "activePageGeneration";
export const CANVAS_RECORDS_NAME = "tldraw";
export const CANVAS_META_NAME = "haunter-meta";
export const DOCUMENT_SEED_LEASE_MS = 2 * 60 * 1000;

export function activePageGeneration(doc: Y.Doc): string | null {
	const value = doc
		.getMap<unknown>(PAGE_META_NAME)
		.get(PAGE_ACTIVE_GENERATION_KEY);
	return typeof value === "string" && value.length > 0 ? value : null;
}

export function pageFragmentName(generation: string | null): string {
	return generation
		? `${PAGE_FRAGMENT_NAME}:${generation}`
		: PAGE_FRAGMENT_NAME;
}

export function pageTitleName(generation: string | null): string {
	return generation ? `${PAGE_TITLE_NAME}:${generation}` : PAGE_TITLE_NAME;
}

export type DocumentKind = "page" | "canvas";
export type DocumentProvider = "liveblocks" | "hocuspocus";
export type DocumentState = "pending" | "seeding" | "ready" | "error";

export type CollaborativeDocument = {
	documentId: string;
	provider: DocumentProvider;
	kind: DocumentKind;
	entityId: string;
	workspaceId: string;
	schemaVersion: number;
	state: DocumentState;
	revision: number;
	lastStateVector: string | null;
	seededAt: string | null;
	lastProjectedAt: string | null;
	lastError: string | null;
	createdAt: string;
	updatedAt: string;
};

export type DocumentTaskAttribution = {
	id: string;
	documentId: string;
	workspaceId: string;
	blockId: string;
	assignee: string;
	actorUserId: string;
	actorName: string;
	createdAt: string;
	updatedAt: string;
};

export type NewDocumentTaskAttribution = Pick<
	DocumentTaskAttribution,
	"blockId" | "assignee" | "actorUserId" | "actorName"
>;

export type NewCollaborativeDocument = Pick<
	CollaborativeDocument,
	"documentId" | "provider" | "kind" | "entityId" | "workspaceId"
> & {
	schemaVersion?: number;
};

export function documentId(kind: DocumentKind, entityId: string): string {
	return `doc:v2:${kind}:${entityId}`;
}

export function parseDocumentId(value: string): {
	kind: DocumentKind;
	entityId: string;
} | null {
	const [prefix, version, kind, entityId, ...rest] = value.split(":");
	if (
		prefix !== "doc" ||
		version !== "v2" ||
		(kind !== "page" && kind !== "canvas") ||
		!entityId ||
		rest.length > 0
	) {
		return null;
	}
	return { kind, entityId };
}
