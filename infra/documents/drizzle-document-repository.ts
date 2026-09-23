import { tenantScopeId } from "@beignet/core/ports";
import type { DrizzleSqliteDatabase } from "@beignet/provider-db-drizzle/sqlite";
import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import * as Y from "yjs";
import type { DocumentRepository } from "@/features/documents/ports";
import { DOCUMENT_SCHEMA_VERSION } from "@/features/documents/model";
import * as schema from "@/infra/db/schema";
import { PageContentSchema } from "@/features/pages/schemas";
import { extractPageSearchText } from "@/features/pages/lib/extract-page-text";
import { appError } from "@/features/shared/errors";
import { assertDocumentRevision } from "@/features/documents/revision";

export function createDrizzleDocumentRepository(
	db: DrizzleSqliteDatabase<typeof schema>,
): DocumentRepository {
	const repository: DocumentRepository = {
		async assertWorkerLease(ownerId) {
			const [lease] = await db
				.select()
				.from(schema.collaborationWorkerLease)
				.where(
					and(
						eq(schema.collaborationWorkerLease.id, 1),
						eq(schema.collaborationWorkerLease.ownerId, ownerId),
						gt(schema.collaborationWorkerLease.expiresAt, Date.now()),
					),
				);
			if (!lease) throw new Error("Collaboration worker lease expired");
		},
		async getGeneration(scope, pageId) {
			const [row] = await db
				.select({ generation: schema.collaborativeDocuments.generation })
				.from(schema.collaborativeDocuments)
				.where(
					and(
						eq(schema.collaborativeDocuments.pageId, pageId),
						eq(schema.collaborativeDocuments.workspaceId, tenantScopeId(scope)),
					),
				);
			return row?.generation ?? null;
		},
		async restoreBody(scope, pageId, content, expectedRevision) {
			const stored = await repository.find(scope, pageId);
			if (!stored)
				throw new Error(
					"Page body is not migrated. Run the document migration before starting the app.",
				);
			const { seedPageBody, projectPageBody } = await import("./codec");
			assertDocumentRevision(stored, expectedRevision);
			if (expectedRevision !== undefined) {
				const { validateReplacementBlocks } = await import("./block-edits");
				const current = new Y.Doc();
				try {
					Y.applyUpdate(current, stored.state);
					validateReplacementBlocks(content, projectPageBody(current));
				} finally {
					current.destroy();
				}
			}
			const generation = stored.generation + 1;
			const doc = seedPageBody(PageContentSchema.parse(content));
			try {
				if (expectedRevision !== undefined) {
					const { validateDocumentUpdate } = await import("./validate-update");
					validateDocumentUpdate(doc, new Uint8Array([0, 0]));
				}
				const projected = PageContentSchema.parse(projectPageBody(doc));
				const saved = await repository.commit(scope, {
					pageId,
					baseRevision: stored.revision,
					generation: stored.generation,
					nextGeneration: generation,
					state: Y.encodeStateAsUpdate(doc),
					contentJson: JSON.stringify(projected),
					searchText: extractPageSearchText(projected),
				});
				return { ...saved, content: projected, documentGeneration: generation };
			} finally {
				doc.destroy();
			}
		},
		async findChanged(scope, known) {
			if (!known.length) return [];
			// Bound SQL parameter counts when a workspace has many open documents.
			const result = [];
			for (let offset = 0; offset < known.length; offset += 100) {
				const rows = await db
					.select()
					.from(schema.collaborativeDocuments)
					.where(
						and(
							eq(
								schema.collaborativeDocuments.workspaceId,
								tenantScopeId(scope),
							),
							or(
								...known
									.slice(offset, offset + 100)
									.map((item) =>
										and(
											eq(schema.collaborativeDocuments.pageId, item.pageId),
											gt(schema.collaborativeDocuments.revision, item.revision),
										),
									),
							),
						),
					);
				for (const row of rows) {
					if (row.schemaVersion !== DOCUMENT_SCHEMA_VERSION)
						throw new Error("Unsupported collaborative document schema");
					result.push({
						pageId: row.pageId,
						state: new Uint8Array(row.state),
						revision: row.revision,
						generation: row.generation,
					});
				}
			}
			return result;
		},
		async appendBlocks(scope, pageId, blocks) {
			return mutate(scope, pageId, async (doc) => {
				const { appendDocumentBlocks } = await import("./mutations");
				appendDocumentBlocks(doc, blocks);
				return true;
			});
		},
		async patchBlockProps(scope, input) {
			return mutate(scope, input.pageId, async (doc) => {
				const { patchDocumentBlockProps } = await import("./mutations");
				return patchDocumentBlockProps(doc, input);
			});
		},
		async editBlocks(scope, input) {
			let insertedBlockIds: string[] = [];
			const saved = await mutate(
				scope,
				input.pageId,
				async (doc) => {
					const { editDocumentBlocks } = await import("./block-edits");
					insertedBlockIds = editDocumentBlocks(doc, input.operations);
					const { validateDocumentUpdate } = await import("./validate-update");
					validateDocumentUpdate(doc, new Uint8Array([0, 0]));
					return true;
				},
				input.expectedRevision,
			);
			return { ...saved, insertedBlockIds };
		},
		async find(scope, pageId) {
			const [row] = await db
				.select()
				.from(schema.collaborativeDocuments)
				.where(
					and(
						eq(schema.collaborativeDocuments.pageId, pageId),
						eq(schema.collaborativeDocuments.workspaceId, tenantScopeId(scope)),
					),
				);
			if (!row) return null;
			if (row.schemaVersion !== DOCUMENT_SCHEMA_VERSION)
				throw new Error("Unsupported collaborative document schema");
			return {
				pageId,
				state: new Uint8Array(row.state),
				revision: row.revision,
				generation: row.generation,
			};
		},
		async insert(scope, pageId, state) {
			await db.insert(schema.collaborativeDocuments).values({
				pageId,
				workspaceId: tenantScopeId(scope),
				state: Buffer.from(state),
				updatedAt: new Date().toISOString(),
			});
		},
		async commit(scope, input) {
			const workspaceId = tenantScopeId(scope);
			const [current] = await db
				.select({
					contentUpdatedAt: schema.pages.contentUpdatedAt,
					updatedAt: schema.pages.updatedAt,
				})
				.from(schema.pages)
				.where(
					and(
						eq(schema.pages.id, input.pageId),
						eq(schema.pages.workspaceId, workspaceId),
					),
				);
			if (!current) throw appError("PageNotFound");
			const updatedAt = new Date(
				Math.max(
					Date.now(),
					Date.parse(current.contentUpdatedAt) + 1,
					Date.parse(current.updatedAt) + 1,
				),
			).toISOString();
			const [document] = await db
				.update(schema.collaborativeDocuments)
				.set({
					state: Buffer.from(input.state),
					revision: input.baseRevision + 1,
					generation: input.nextGeneration ?? input.generation,
					updatedAt,
				})
				.where(
					and(
						eq(schema.collaborativeDocuments.pageId, input.pageId),
						eq(schema.collaborativeDocuments.workspaceId, workspaceId),
						eq(schema.collaborativeDocuments.revision, input.baseRevision),
						eq(schema.collaborativeDocuments.generation, input.generation),
					),
				)
				.returning({ revision: schema.collaborativeDocuments.revision });
			if (!document)
				throw new Error(
					"Collaborative document ownership changed. Run only one Hocuspocus server.",
				);
			const [page] = await db
				.update(schema.pages)
				.set({
					content: input.contentJson,
					searchText: input.searchText,
					contentUpdatedAt: sql`max(${schema.pages.contentUpdatedAt}, ${updatedAt})`,
					updatedAt: sql`max(${schema.pages.updatedAt}, ${updatedAt})`,
				})
				.where(
					and(
						eq(schema.pages.id, input.pageId),
						eq(schema.pages.workspaceId, workspaceId),
					),
				)
				.returning({
					contentUpdatedAt: schema.pages.contentUpdatedAt,
					updatedAt: schema.pages.updatedAt,
				});
			if (!page) throw new Error("Collaborative page no longer exists");
			return { ...document, ...page };
		},
	};
	async function mutate(
		scope: Parameters<DocumentRepository["find"]>[0],
		pageId: string,
		change: (doc: Y.Doc) => Promise<boolean>,
		expectedRevision?: string,
	) {
		const [page] = await db
			.select({ id: schema.pages.id })
			.from(schema.pages)
			.where(
				and(
					eq(schema.pages.id, pageId),
					eq(schema.pages.workspaceId, tenantScopeId(scope)),
					isNull(schema.pages.deletedAt),
				),
			);
		if (!page) throw appError("PageNotFound");
		const stored = await repository.find(scope, pageId);
		if (!stored)
			throw new Error(
				"Page body is not migrated. Run the document migration before starting the app.",
			);
		assertDocumentRevision(stored, expectedRevision);
		const doc = new Y.Doc();
		try {
			Y.applyUpdate(doc, stored.state);
			const found = await change(doc);
			// A missing task block must roll back its task-row update too.
			if (!found)
				throw appError("TaskNotEditable", {
					message: "This task block no longer exists in the page.",
				});
			const { projectPageBody } = await import("./codec");
			const content = PageContentSchema.parse(projectPageBody(doc));
			const saved = await repository.commit(scope, {
				pageId,
				baseRevision: stored.revision,
				generation: stored.generation,
				state: Y.encodeStateAsUpdate(doc),
				contentJson: JSON.stringify(content),
				searchText: extractPageSearchText(content),
			});
			return { ...saved, content, found, generation: stored.generation };
		} finally {
			doc.destroy();
		}
	}
	return repository;
}
