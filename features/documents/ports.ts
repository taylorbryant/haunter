import type { TenantScope } from "@beignet/core/ports";
import type { BlockJson } from "@/features/content/schemas";
import type { PageBlockOperation } from "@/features/pages/block-editing";

export type StoredDocument = {
	pageId: string;
	state: Uint8Array;
	revision: number;
	generation: number;
};

export interface DocumentRepository {
	/** Checked in the same transaction as a worker commit. */
	assertWorkerLease(ownerId: string): Promise<void>;
	getGeneration(scope: TenantScope, pageId: string): Promise<number | null>;
	/** Replace a body and fence every client of its previous generation. */
	restoreBody(
		scope: TenantScope,
		pageId: string,
		content: BlockJson[],
		expectedRevision?: string,
	): Promise<DocumentWriteResult & { documentGeneration: number }>;
	editBlocks(
		scope: TenantScope,
		input: {
			pageId: string;
			expectedRevision: string;
			operations: PageBlockOperation[];
		},
	): Promise<
		DocumentWriteResult & { generation: number; insertedBlockIds: string[] }
	>;
	find(scope: TenantScope, pageId: string): Promise<StoredDocument | null>;
	/** Read only newer snapshots for documents currently loaded by a worker. */
	findChanged(
		scope: TenantScope,
		known: { pageId: string; revision: number }[],
	): Promise<StoredDocument[]>;
	/** Transactional targeted writes; missing binary state is a migration error. */
	appendBlocks(
		scope: TenantScope,
		pageId: string,
		blocks: BlockJson[],
	): Promise<DocumentWriteResult>;
	patchBlockProps(
		scope: TenantScope,
		input: {
			pageId: string;
			blockId: string;
			blockType: string;
			props: Record<string, string | boolean | number>;
		},
	): Promise<DocumentWriteResult & { found: boolean }>;
	/** Called within the page creation or one-time migration transaction. */
	insert(scope: TenantScope, pageId: string, state: Uint8Array): Promise<void>;
	/** Atomically replace binary state and its SQL content projection. */
	commit(
		scope: TenantScope,
		input: {
			pageId: string;
			baseRevision: number;
			generation: number;
			nextGeneration?: number;
			state: Uint8Array;
			contentJson: string;
			searchText: string;
		},
	): Promise<{ revision: number; updatedAt: string; contentUpdatedAt: string }>;
}

export type DocumentWriteResult = {
	revision: number;
	updatedAt: string;
	contentUpdatedAt: string;
	content: BlockJson[];
};

export type DocumentGrant = {
	/** Absent on existing page tokens; pageId is the historical resource-ID field. */
	kind?: "page" | "canvas";
	userId: string;
	sessionId: string;
	workspaceId: string;
	pageId: string;
	generation: number;
	expiresAt: number;
};

export interface DocumentSessionPort {
	issue(input: Omit<DocumentGrant, "expiresAt">): { token: string };
}

export interface DocumentRecoveryPort {
	decodeCanvas(update: number[]): Promise<Record<string, unknown>>;
	decode(update: number[]): Promise<BlockJson[]>;
	normalize(content: BlockJson[]): Promise<BlockJson[]>;
}

export type DocumentMigrationReport = {
	database: string;
	pages: number;
	canvases: number;
	canvasesConverted: number;
	converted: number;
	projectionsUpdated: number;
	existing: number;
	trashed: number;
	dryRun: boolean;
	backupPath?: string;
};

/** Offline operational task; never used to initialize a document during reads. */
export interface DocumentMaintenancePort {
	migrate(input: {
		dryRun: boolean;
		expectedDatabase?: string;
		backupPath?: string;
	}): Promise<DocumentMigrationReport>;
}
