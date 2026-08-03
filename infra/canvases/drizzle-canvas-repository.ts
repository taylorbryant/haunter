import "@beignet/core/server-only";
import { tenantScopeId } from "@beignet/core/ports";
import type { DrizzleSqliteDatabase } from "@beignet/provider-db-drizzle/sqlite";
import { and, eq, inArray } from "drizzle-orm";
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
		snapshot: JSON.parse(row.snapshot) as CanvasSnapshot,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

export function createDrizzleCanvasRepository(
	db: DrizzleSqliteDatabase<typeof schema>,
): CanvasRepository {
	return {
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
			await assertPageInScope(db, scope, input.pageId);
			const now = new Date().toISOString();
			const canvas = {
				id: crypto.randomUUID(),
				userId: input.userId,
				workspaceId: tenantScopeId(scope),
				pageId: input.pageId,
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
		async listIdsByPageIds(scope, pageIds) {
			if (pageIds.length === 0) return [];
			const rows = await db
				.select({ id: schema.canvases.id })
				.from(schema.canvases)
				.where(
					and(
						inArray(schema.canvases.pageId, pageIds),
						eq(schema.canvases.workspaceId, tenantScopeId(scope)),
					),
				);
			return rows.map((row) => row.id);
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
