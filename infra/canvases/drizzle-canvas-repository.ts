import "@beignet/core/server-only";
import { tenantScopeId } from "@beignet/core/ports";
import type { DrizzleSqliteDatabase } from "@beignet/provider-db-drizzle/sqlite";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
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
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

export function createDrizzleCanvasRepository(
	db: DrizzleSqliteDatabase<typeof schema>,
): CanvasRepository {
	return {
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
				createdAt: now,
				updatedAt: now,
			};
			const [row] = await db.insert(schema.canvases).values(canvas).returning();

			if (!row) {
				throw new Error("Failed to create canvas");
			}

			return toCanvas(row);
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
		async saveSnapshot(scope, id: string, snapshotJson: string) {
			const updatedAt = new Date().toISOString();
			const [row] = await db
				.update(schema.canvases)
				.set({ snapshot: snapshotJson, updatedAt })
				.where(
					and(
						eq(schema.canvases.id, id),
						eq(schema.canvases.workspaceId, tenantScopeId(scope)),
					),
				)
				.returning({ id: schema.canvases.id });

			if (!row) {
				throw new Error(`Failed to save snapshot for canvas ${id}`);
			}

			return { updatedAt };
		},
		async saveSnapshotIf(
			scope,
			id: string,
			snapshotJson: string,
			baseUpdatedAt: string,
		) {
			// Strictly after the base version; see saveContentIf on pages.
			const updatedAt = new Date(
				Math.max(Date.now(), Date.parse(baseUpdatedAt) + 1),
			).toISOString();
			// The WHERE clause is the compare-and-set: no row updates when
			// another writer already bumped updatedAt.
			const [row] = await db
				.update(schema.canvases)
				.set({ snapshot: snapshotJson, updatedAt })
				.where(
					and(
						eq(schema.canvases.id, id),
						eq(schema.canvases.workspaceId, tenantScopeId(scope)),
						eq(schema.canvases.updatedAt, baseUpdatedAt),
					),
				)
				.returning({ id: schema.canvases.id });

			return row ? { updatedAt } : null;
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
