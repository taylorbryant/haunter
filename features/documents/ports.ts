import type { TenantScope } from "@beignet/core/ports";
import type {
	CollaborativeDocument,
	DocumentKind,
	DocumentProvider,
	DocumentTaskAttribution,
	NewCollaborativeDocument,
	NewDocumentTaskAttribution,
} from "./model";

export interface DocumentRegistryRepository {
	findByDocumentId(
		scope: TenantScope,
		documentId: string,
	): Promise<CollaborativeDocument | null>;
	/** Signed provider webhooks have no user tenant; never expose this method to
	 * request use cases without independently authenticating the caller. */
	findGlobalByDocumentId(
		documentId: string,
	): Promise<CollaborativeDocument | null>;
	findByEntity(
		scope: TenantScope,
		kind: DocumentKind,
		entityId: string,
	): Promise<CollaborativeDocument | null>;
	createPending(
		scope: TenantScope,
		input: NewCollaborativeDocument,
	): Promise<CollaborativeDocument>;
	/** Atomically claim the right to initialize or repair a provider document.
	 * The returned revision is the fencing token for completion. */
	claimSeed(
		scope: TenantScope,
		documentId: string,
		input: {
			expectedRevision: number;
			expiredBefore: string;
			allowReadyRepair: boolean;
		},
	): Promise<CollaborativeDocument | null>;
	/** Extend an active seed claim without changing its fencing revision. */
	renewSeed(
		scope: TenantScope,
		documentId: string,
		input: { expectedRevision: number },
	): Promise<boolean>;
	markReady(
		scope: TenantScope,
		documentId: string,
		input: { stateVector: string; expectedRevision: number },
	): Promise<boolean>;
	markProjected(
		scope: TenantScope,
		documentId: string,
		input: { stateVector: string; expectedRevision: number },
	): Promise<boolean>;
	markError(
		scope: TenantScope,
		documentId: string,
		input: { message: string; expectedRevision: number },
	): Promise<boolean>;
	recordTaskAttributions(
		scope: TenantScope,
		documentId: string,
		attributions: readonly NewDocumentTaskAttribution[],
	): Promise<void>;
	listTaskAttributions(
		scope: TenantScope,
		documentId: string,
	): Promise<DocumentTaskAttribution[]>;
	deleteTaskAttributions(
		scope: TenantScope,
		documentId: string,
		ids: readonly string[],
	): Promise<void>;
	deleteByEntities(
		scope: TenantScope,
		entities: Array<{ kind: DocumentKind; entityId: string }>,
	): Promise<string[]>;
	listPending(limit: number): Promise<CollaborativeDocument[]>;
}

/** Provider-neutral binary Yjs storage. A Hocuspocus adapter can implement
 * this port without changing page, canvas, MCP, or materialization code. */
export interface DocumentStorePort {
	readonly provider: DocumentProvider;
	ensureDocument(input: {
		documentId: string;
		workspaceId: string;
		kind: DocumentKind;
	}): Promise<void>;
	readBinaryUpdate(documentId: string): Promise<Uint8Array | null>;
	applyBinaryUpdate(documentId: string, update: Uint8Array): Promise<void>;
	deleteDocument(documentId: string): Promise<void>;
}
