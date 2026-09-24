import {
	createCanvasRoom,
	projectCanvasRoom,
} from "@/features/canvases/lib/document";
import "@beignet/core/server-only";
import { tenantScopeId } from "@beignet/core/ports";
import type { DrizzleSqliteDatabase } from "@beignet/provider-db-drizzle/sqlite";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { CanvasRepository, NewCanvas } from "@/features/canvases/ports";
import type { Canvas, CanvasSnapshot } from "@/features/canvases/schemas";
import * as schema from "@/infra/db/schema";
import { assertPageInScope } from "@/infra/db/tenant-scope";

type CanvasRow = typeof schema.canvases.$inferSelect;

function toCanvas(row: CanvasRow): Canvas {
	return {
		id: row.id,
		userId: row.userId,
		workspaceId: row.workspaceId,
		pageId: row.pageId,
		title: row.title,
		snapshot: JSON.parse(row.snapshot) as CanvasSnapshot,
		snapshotUpdatedAt: row.snapshotUpdatedAt,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

export function createDrizzleCanvasRepository(
	db: DrizzleSqliteDatabase<typeof schema>,
): CanvasRepository {
	return {
		async saveHistory(scope, input) {
			const id = crypto.randomUUID();
			await db.insert(schema.canvasHistory).values({
				id,
				canvasId: input.canvasId,
				workspaceId: tenantScopeId(scope),
				revision: input.revision,
				snapshot: input.snapshotJson,
				createdBy: input.createdBy,
				createdAt: new Date().toISOString(),
			});
			const old = await db
				.select({ id: schema.canvasHistory.id })
				.from(schema.canvasHistory)
				.where(
					and(
						eq(schema.canvasHistory.canvasId, input.canvasId),
						eq(schema.canvasHistory.workspaceId, tenantScopeId(scope)),
					),
				)
				.orderBy(desc(schema.canvasHistory.revision))
				.limit(1_000)
				.offset(50);
			if (old.length)
				await db.delete(schema.canvasHistory).where(
					inArray(
						schema.canvasHistory.id,
						old.map((row) => row.id),
					),
				);
			return id;
		},
		async listHistory(scope, canvasId) {
			return db
				.select({
					id: schema.canvasHistory.id,
					revision: schema.canvasHistory.revision,
					createdAt: schema.canvasHistory.createdAt,
				})
				.from(schema.canvasHistory)
				.where(
					and(
						eq(schema.canvasHistory.canvasId, canvasId),
						eq(schema.canvasHistory.workspaceId, tenantScopeId(scope)),
					),
				)
				.orderBy(desc(schema.canvasHistory.revision))
				.limit(50);
		},
		async findHistory(scope, canvasId, id) {
			const [row] = await db
				.select({
					snapshotJson: schema.canvasHistory.snapshot,
					revision: schema.canvasHistory.revision,
				})
				.from(schema.canvasHistory)
				.where(
					and(
						eq(schema.canvasHistory.id, id),
						eq(schema.canvasHistory.canvasId, canvasId),
						eq(schema.canvasHistory.workspaceId, tenantScopeId(scope)),
					),
				);
			return row ?? null;
		},
		async findSyncRoom(scope, id) {
			const [row] = await db
				.select()
				.from(schema.canvasSyncRooms)
				.where(
					and(
						eq(schema.canvasSyncRooms.canvasId, id),
						eq(schema.canvasSyncRooms.workspaceId, tenantScopeId(scope)),
					),
				);
			if (row && row.schemaVersion !== 1)
				throw new Error("Unsupported canvas sync schema");
			return row
				? {
						roomJson: row.snapshot,
						revision: row.revision,
					}
				: null;
		},
		async commitSyncRoom(scope, input) {
			const now = new Date().toISOString();
			const [row] = await db
				.update(schema.canvasSyncRooms)
				.set({
					snapshot: input.roomJson,
					revision: input.baseRevision + 1,
					updatedAt: now,
				})
				.where(
					and(
						eq(schema.canvasSyncRooms.canvasId, input.id),
						eq(schema.canvasSyncRooms.workspaceId, tenantScopeId(scope)),
						eq(schema.canvasSyncRooms.revision, input.baseRevision),
					),
				)
				.returning();
			if (!row) throw new Error("Canvas changed or was deleted");
			const [canvas] = await db
				.update(schema.canvases)
				.set({
					snapshot: input.snapshotJson,
					updatedAt: sql`max(updated_at, ${now})`,
					snapshotUpdatedAt: now,
				})
				.where(
					and(
						eq(schema.canvases.id, input.id),
						eq(schema.canvases.workspaceId, tenantScopeId(scope)),
					),
				)
				.returning();
			if (!canvas) throw new Error("Canvas deleted");
			return {
				revision: row.revision,
				updatedAt: canvas.updatedAt,
				snapshotUpdatedAt: now,
			};
		},
		async listStandalone(scope) {
			const rows = await db
				.select({
					id: schema.canvases.id,
					userId: schema.canvases.userId,
					workspaceId: schema.canvases.workspaceId,
					pageId: schema.canvases.pageId,
					title: schema.canvases.title,
					createdAt: schema.canvases.createdAt,
					updatedAt: schema.canvases.updatedAt,
				})
				.from(schema.canvases)
				.where(
					and(
						eq(schema.canvases.workspaceId, tenantScopeId(scope)),
						isNull(schema.canvases.pageId),
					),
				)
				.orderBy(desc(schema.canvases.updatedAt));

			return rows;
		},
		async findById(scope, id: string) {
			const [row] = await db
				.select()
				.from(schema.canvases)
				.where(
					and(
						eq(schema.canvases.id, id),
						eq(schema.canvases.workspaceId, tenantScopeId(scope)),
					),
				)
				.limit(1);

			return row ? toCanvas(row) : null;
		},
		async create(scope, input: NewCanvas) {
			if (input.pageId !== null) {
				await assertPageInScope(db, scope, input.pageId);
			}
			const now = new Date().toISOString();
			const canvas = {
				id: crypto.randomUUID(),
				userId: input.userId,
				workspaceId: tenantScopeId(scope),
				pageId: input.pageId,
				title: input.title,
				snapshot: "{}",
				snapshotUpdatedAt: now,
				createdAt: now,
				updatedAt: now,
			};
			const room = createCanvasRoom({});
			{
				canvas.snapshot = JSON.stringify(projectCanvasRoom(room));
				return await db.transaction(async (tx) => {
					const [row] = await tx
						.insert(schema.canvases)
						.values(canvas)
						.returning();
					if (!row) throw new Error("Failed to create canvas");
					await tx.insert(schema.canvasSyncRooms).values({
						canvasId: row.id,
						workspaceId: row.workspaceId,
						snapshot: JSON.stringify(room),
						updatedAt: now,
					});
					return toCanvas(row);
				});
			}
		},
		async updateTitle(scope, id: string, title: string) {
			const updatedAt = new Date().toISOString();
			const [row] = await db
				.update(schema.canvases)
				.set({ title, updatedAt })
				.where(
					and(
						eq(schema.canvases.id, id),
						eq(schema.canvases.workspaceId, tenantScopeId(scope)),
						isNull(schema.canvases.pageId),
					),
				)
				.returning();

			if (!row) {
				throw new Error(`Failed to update canvas ${id}`);
			}

			return toCanvas(row);
		},
		async initializeSnapshot(scope, id, snapshotJson) {
			const room = createCanvasRoom(JSON.parse(snapshotJson));
			{
				// Only used inside the transaction that creates a recovery canvas.
				return await db.transaction(async (tx) => {
					const repository = createDrizzleCanvasRepository(tx);
					return repository.commitSyncRoom(scope, {
						id,
						roomJson: JSON.stringify(room),
						snapshotJson: JSON.stringify(projectCanvasRoom(room)),
						baseRevision: 0,
					});
				});
			}
		},
		async delete(scope, id: string) {
			await db
				.delete(schema.canvases)
				.where(
					and(
						eq(schema.canvases.id, id),
						eq(schema.canvases.workspaceId, tenantScopeId(scope)),
						isNull(schema.canvases.pageId),
					),
				);
		},
		async deleteByPageIds(scope, pageIds: string[]) {
			if (pageIds.length === 0) return;
			await db
				.delete(schema.canvases)
				.where(
					and(
						inArray(schema.canvases.pageId, pageIds),
						eq(schema.canvases.workspaceId, tenantScopeId(scope)),
					),
				);
		},
	};
}
