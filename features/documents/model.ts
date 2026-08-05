import type * as Y from "yjs";

export const DOCUMENT_SCHEMA_VERSION = 1;
export const PAGE_FRAGMENT_NAME = "blocknote";
export const PAGE_TITLE_NAME = "title";
export const PAGE_TASK_ATTRIBUTIONS_NAME = "task-attribution-operations";
export const PAGE_META_NAME = "haunter-meta";
export const PAGE_ACTIVE_GENERATION_KEY = "activePageGeneration";
export const CANVAS_RECORDS_NAME = "tldraw";
export const CANVAS_META_NAME = "haunter-meta";
export const DOCUMENT_SEED_LEASE_MS = 2 * 60 * 1000;
export const DOCUMENT_PROVIDER_VERIFICATION_TTL_MS = 5 * 60 * 1000;

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

export function pageTaskAttributionsName(generation: string | null): string {
	return generation
		? `${PAGE_TASK_ATTRIBUTIONS_NAME}:${generation}`
		: PAGE_TASK_ATTRIBUTIONS_NAME;
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
	lastProviderVerifiedAt: string | null;
	lastProjectedAt: string | null;
	lastError: string | null;
	createdAt: string;
	updatedAt: string;
};

/** Provider verification is an availability/integrity check, not an
 * authorization cache. User, workspace, and role checks still run for every
 * room token request. */
export function isProviderVerificationFresh(
	document: Pick<CollaborativeDocument, "state" | "lastProviderVerifiedAt">,
	now = Date.now(),
): boolean {
	if (document.state !== "ready" || !document.lastProviderVerifiedAt) {
		return false;
	}
	const verifiedAt = Date.parse(document.lastProviderVerifiedAt);
	return (
		Number.isFinite(verifiedAt) &&
		verifiedAt <= now &&
		verifiedAt >= now - DOCUMENT_PROVIDER_VERIFICATION_TTL_MS
	);
}

export type DocumentTaskAttribution = {
	id: string;
	documentId: string;
	workspaceId: string;
	blockId: string;
	assignee: string;
	operationId: string | null;
	actorUserId: string;
	actorName: string;
	createdAt: string;
	updatedAt: string;
};

export type NewDocumentTaskAttribution = Pick<
	DocumentTaskAttribution,
	"blockId" | "assignee" | "operationId" | "actorUserId" | "actorName"
>;

export type NewCollaborativeDocument = Pick<
	CollaborativeDocument,
	"documentId" | "provider" | "kind" | "entityId" | "workspaceId"
> & {
	schemaVersion?: number;
};

/**
 * Stable identity for one provider-backed incarnation of a document.
 *
 * Materialization advances `revision`, so it cannot key the browser cache.
 * `seededAt` changes only when the provider document is first seeded or
 * repaired, which lets a repaired room start from a fresh IndexedDB database
 * instead of merging an incompatible cached Yjs history into the new room.
 */
export function documentCacheEpoch(
	document: Pick<
		CollaborativeDocument,
		"schemaVersion" | "seededAt" | "createdAt"
	>,
): string {
	return `${document.schemaVersion}:${document.seededAt ?? `pending:${document.createdAt}`}`;
}

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
