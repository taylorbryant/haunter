import "@beignet/core/server-only";
import type { DrizzleSqliteDatabase } from "@beignet/provider-db-drizzle/sqlite";
import { eq, inArray } from "drizzle-orm";
import type { CanvasRepository, NewCanvas } from "@/features/canvases/ports";
import type { Canvas, CanvasSnapshot } from "@/features/canvases/schemas";
import * as schema from "@/infra/db/schema";

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
		async findById(id: string) {
			const [row] = await db
				.select()
				.from(schema.canvases)
				.where(eq(schema.canvases.id, id))
				.limit(1);

			return row ? toCanvas(row) : null;
		},
		async create(input: NewCanvas) {
			const now = new Date().toISOString();
			const canvas = {
				id: crypto.randomUUID(),
				userId: input.userId,
				workspaceId: input.workspaceId,
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
		async saveSnapshot(id: string, snapshotJson: string) {
			const updatedAt = new Date().toISOString();
			const [row] = await db
				.update(schema.canvases)
				.set({ snapshot: snapshotJson, updatedAt })
				.where(eq(schema.canvases.id, id))
				.returning({ id: schema.canvases.id });

			if (!row) {
				throw new Error(`Failed to save snapshot for canvas ${id}`);
			}

			return { updatedAt };
		},
		async deleteByPageIds(pageIds: string[]) {
			if (pageIds.length === 0) return;
			await db
				.delete(schema.canvases)
				.where(inArray(schema.canvases.pageId, pageIds));
		},
	};
}
