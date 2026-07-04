import "@beignet/core/server-only";
import type { DrizzleSqliteDatabase } from "@beignet/provider-db-drizzle/sqlite";
import { and, eq, inArray } from "drizzle-orm";
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
		async saveSnapshotIf(
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
						eq(schema.canvases.updatedAt, baseUpdatedAt),
					),
				)
				.returning({ id: schema.canvases.id });

			return row ? { updatedAt } : null;
		},
		async deleteByPageIds(pageIds: string[]) {
			if (pageIds.length === 0) return;
			await db
				.delete(schema.canvases)
				.where(inArray(schema.canvases.pageId, pageIds));
		},
	};
}
