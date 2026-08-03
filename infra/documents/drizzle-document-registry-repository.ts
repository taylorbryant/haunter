import "@beignet/core/server-only";
import { type TenantScope, tenantScopeId } from "@beignet/core/ports";
import type { DrizzleSqliteDatabase } from "@beignet/provider-db-drizzle/sqlite";
import { and, asc, desc, eq, inArray, lte, or, sql } from "drizzle-orm";
import {
	type CollaborativeDocument,
	DOCUMENT_SCHEMA_VERSION,
	DOCUMENT_SEED_LEASE_MS,
	type DocumentKind,
	type DocumentProvider,
	type DocumentState,
} from "@/features/documents/model";
import type { DocumentRegistryRepository } from "@/features/documents/ports";
import type * as schemaType from "@/infra/db/schema";
import * as schema from "@/infra/db/schema";

type Row = typeof schema.collabDocuments.$inferSelect;

function toDocument(row: Row): CollaborativeDocument {
	return {
		...row,
		provider: row.provider as DocumentProvider,
		kind: row.kind as DocumentKind,
		state: row.state as DocumentState,
	};
}

function scopedWhere(scope: TenantScope, documentId: string) {
	return and(
		eq(schema.collabDocuments.workspaceId, tenantScopeId(scope)),
		eq(schema.collabDocuments.documentId, documentId),
	);
}

export function createDrizzleDocumentRegistryRepository(
	db: DrizzleSqliteDatabase<typeof schemaType>,
): DocumentRegistryRepository {
	return {
		async findByDocumentId(scope, id) {
			const [row] = await db
				.select()
				.from(schema.collabDocuments)
				.where(scopedWhere(scope, id))
				.limit(1);
			return row ? toDocument(row) : null;
		},
		async findGlobalByDocumentId(id) {
			const [row] = await db
				.select()
				.from(schema.collabDocuments)
				.where(eq(schema.collabDocuments.documentId, id))
				.limit(1);
			return row ? toDocument(row) : null;
		},
		async findByEntity(scope, kind, entityId) {
			const [row] = await db
				.select()
				.from(schema.collabDocuments)
				.where(
					and(
						eq(schema.collabDocuments.workspaceId, tenantScopeId(scope)),
						eq(schema.collabDocuments.kind, kind),
						eq(schema.collabDocuments.entityId, entityId),
					),
				)
				.limit(1);
			return row ? toDocument(row) : null;
		},
		async createPending(scope, input) {
			const now = new Date().toISOString();
			const [row] = await db
				.insert(schema.collabDocuments)
				.values({
					...input,
					workspaceId: tenantScopeId(scope),
					schemaVersion: input.schemaVersion ?? DOCUMENT_SCHEMA_VERSION,
					state: "pending",
					revision: 0,
					createdAt: now,
					updatedAt: now,
				})
				.onConflictDoNothing({
					target: [
						schema.collabDocuments.kind,
						schema.collabDocuments.entityId,
					],
				})
				.returning();
			if (row) return toDocument(row);
			const existing = await this.findByEntity(
				scope,
				input.kind,
				input.entityId,
			);
			if (!existing)
				throw new Error("Failed to register collaborative document");
			return existing;
		},
		async claimSeed(scope, id, input) {
			const claimable = [
				inArray(schema.collabDocuments.state, ["pending", "error"]),
				and(
					eq(schema.collabDocuments.state, "seeding"),
					lte(schema.collabDocuments.updatedAt, input.expiredBefore),
				),
				input.allowReadyRepair
					? eq(schema.collabDocuments.state, "ready")
					: undefined,
			].filter((condition) => condition !== undefined);
			const [claimed] = await db
				.update(schema.collabDocuments)
				.set({
					state: "seeding",
					lastError: null,
					updatedAt: new Date().toISOString(),
					revision: sql`${schema.collabDocuments.revision} + 1`,
				})
				.where(
					and(
						scopedWhere(scope, id),
						eq(schema.collabDocuments.revision, input.expectedRevision),
						or(...claimable),
					),
				)
				.returning();
			return claimed ? toDocument(claimed) : null;
		},
		async renewSeed(scope, id, input) {
			const rows = await db
				.update(schema.collabDocuments)
				.set({ updatedAt: new Date().toISOString() })
				.where(
					and(
						scopedWhere(scope, id),
						eq(schema.collabDocuments.state, "seeding"),
						eq(schema.collabDocuments.revision, input.expectedRevision),
					),
				)
				.returning({ documentId: schema.collabDocuments.documentId });
			return rows.length === 1;
		},
		async markReady(scope, id, input) {
			const now = new Date().toISOString();
			const rows = await db
				.update(schema.collabDocuments)
				.set({
					state: "ready",
					seededAt: now,
					lastStateVector: input.stateVector,
					lastError: null,
					updatedAt: now,
					revision: sql`${schema.collabDocuments.revision} + 1`,
				})
				.where(
					and(
						scopedWhere(scope, id),
						eq(schema.collabDocuments.state, "seeding"),
						eq(schema.collabDocuments.revision, input.expectedRevision),
					),
				)
				.returning({ documentId: schema.collabDocuments.documentId });
			return rows.length === 1;
		},
		async markProjected(scope, id, input) {
			const now = new Date().toISOString();
			const rows = await db
				.update(schema.collabDocuments)
				.set({
					lastProjectedAt: now,
					lastStateVector: input.stateVector,
					lastError: null,
					updatedAt: now,
					revision: sql`${schema.collabDocuments.revision} + 1`,
				})
				.where(
					and(
						scopedWhere(scope, id),
						eq(schema.collabDocuments.revision, input.expectedRevision),
					),
				)
				.returning({ documentId: schema.collabDocuments.documentId });
			return rows.length === 1;
		},
		async markError(scope, id, input) {
			const rows = await db
				.update(schema.collabDocuments)
				.set({
					state: "error",
					lastError: input.message.slice(0, 2000),
					updatedAt: new Date().toISOString(),
				})
				.where(
					and(
						scopedWhere(scope, id),
						eq(schema.collabDocuments.state, "seeding"),
						eq(schema.collabDocuments.revision, input.expectedRevision),
					),
				)
				.returning({ documentId: schema.collabDocuments.documentId });
			return rows.length === 1;
		},
		async recordTaskAttributions(scope, id, attributions) {
			if (attributions.length === 0) return;
			const [document] = await db
				.select({ documentId: schema.collabDocuments.documentId })
				.from(schema.collabDocuments)
				.where(scopedWhere(scope, id))
				.limit(1);
			if (!document) {
				throw new Error(`Collaborative document ${id} is outside the scope`);
			}
			const now = new Date().toISOString();
			for (const attribution of attributions) {
				await db
					.insert(schema.collabTaskAttributions)
					.values({
						id: crypto.randomUUID(),
						documentId: id,
						workspaceId: tenantScopeId(scope),
						...attribution,
						createdAt: now,
						updatedAt: now,
					})
					.onConflictDoUpdate({
						target: [
							schema.collabTaskAttributions.documentId,
							schema.collabTaskAttributions.blockId,
							schema.collabTaskAttributions.assignee,
							schema.collabTaskAttributions.actorUserId,
						],
						set: {
							actorName: attribution.actorName,
							updatedAt: now,
						},
					});
			}
		},
		async listTaskAttributions(scope, id) {
			return db
				.select()
				.from(schema.collabTaskAttributions)
				.where(
					and(
						eq(schema.collabTaskAttributions.workspaceId, tenantScopeId(scope)),
						eq(schema.collabTaskAttributions.documentId, id),
					),
				)
				.orderBy(desc(schema.collabTaskAttributions.updatedAt));
		},
		async deleteTaskAttributions(scope, id, ids) {
			if (ids.length === 0) return;
			await db
				.delete(schema.collabTaskAttributions)
				.where(
					and(
						eq(schema.collabTaskAttributions.workspaceId, tenantScopeId(scope)),
						eq(schema.collabTaskAttributions.documentId, id),
						inArray(schema.collabTaskAttributions.id, [...ids]),
					),
				);
		},
		async deleteByEntities(scope, entities) {
			const pageIds = entities.flatMap((entity) =>
				entity.kind === "page" ? [entity.entityId] : [],
			);
			const canvasIds = entities.flatMap((entity) =>
				entity.kind === "canvas" ? [entity.entityId] : [],
			);
			const kindFilters = [
				pageIds.length > 0
					? and(
							eq(schema.collabDocuments.kind, "page"),
							inArray(schema.collabDocuments.entityId, pageIds),
						)
					: undefined,
				canvasIds.length > 0
					? and(
							eq(schema.collabDocuments.kind, "canvas"),
							inArray(schema.collabDocuments.entityId, canvasIds),
						)
					: undefined,
			].filter((filter) => filter !== undefined);
			if (kindFilters.length === 0) return [];
			const rows = await db
				.delete(schema.collabDocuments)
				.where(
					and(
						eq(schema.collabDocuments.workspaceId, tenantScopeId(scope)),
						or(...kindFilters),
					),
				)
				.returning({ documentId: schema.collabDocuments.documentId });
			return rows.map((row) => row.documentId);
		},
		async listPending(limit) {
			const expiredBefore = new Date(
				Date.now() - DOCUMENT_SEED_LEASE_MS,
			).toISOString();
			const rows = await db
				.select()
				.from(schema.collabDocuments)
				.where(
					or(
						inArray(schema.collabDocuments.state, ["pending", "error"]),
						and(
							eq(schema.collabDocuments.state, "seeding"),
							lte(schema.collabDocuments.updatedAt, expiredBefore),
						),
					),
				)
				.orderBy(asc(schema.collabDocuments.updatedAt))
				.limit(limit);
			return rows.map(toDocument);
		},
	};
}
