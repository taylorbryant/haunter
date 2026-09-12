import type { DrizzleSqliteDatabase } from "@beignet/provider-db-drizzle/sqlite";
import { eq } from "drizzle-orm";

import {
	createCanvasRoom,
	projectCanvasRoom,
	normalizeCanvasSnapshot,
} from "@/features/canvases/lib/document";
import * as schema from "@/infra/db/schema";

export async function prepareCanvases(
	db: DrizzleSqliteDatabase<typeof schema>,
) {
	const canvases = await db.select().from(schema.canvases);
	const documents = await db.select().from(schema.canvasSyncRooms);
	const byId = new Map(documents.map((row) => [row.canvasId, row]));
	const prepared: {
		canvas: (typeof canvases)[number];
		snapshotJson: string;
		snapshot: string;
	}[] = [];
	for (const canvas of canvases) {
		const existing = byId.get(canvas.id);

		try {
			const source = normalizeCanvasSnapshot(JSON.parse(canvas.snapshot));
			if (existing) {
				if (
					existing.schemaVersion !== 1 ||
					existing.workspaceId !== canvas.workspaceId
				)
					throw new Error("Schema/workspace mismatch");
			}
			const room = existing
				? JSON.parse(existing.snapshot)
				: createCanvasRoom({ ...source });
			const projected = projectCanvasRoom(room);
			const canonical = (value: unknown): string =>
				JSON.stringify(value, (_key, v) =>
					v && typeof v === "object" && !Array.isArray(v)
						? Object.fromEntries(
								Object.entries(v).sort(([a], [b]) => a.localeCompare(b)),
							)
						: v,
				);
			if (canonical(projected) !== canonical(source))
				throw new Error("Projection mismatch");
			const snapshotJson = JSON.stringify(room);
			if (snapshotJson.length > 8 * 1024 * 1024)
				throw new Error("Canvas too large");
			if (!existing)
				prepared.push({
					canvas,
					snapshotJson,
					snapshot: JSON.stringify(projected),
				});
		} catch {
			throw new Error(
				`Canvas migration preflight failed for ${canvas.id}. No changes made.`,
			);
		}
	}
	if (
		documents.some(
			(row) => !canvases.some((canvas) => canvas.id === row.canvasId),
		)
	)
		throw new Error("Orphan canvas documents");
	return { canvases, documents, prepared };
}

export async function applyPreparedCanvases(
	db: DrizzleSqliteDatabase<typeof schema>,
	prepared: Awaited<ReturnType<typeof prepareCanvases>>["prepared"],
) {
	for (const { canvas, snapshotJson, snapshot } of prepared)
		await db.transaction(async (tx) => {
			const [current] = await tx
				.select()
				.from(schema.canvases)
				.where(eq(schema.canvases.id, canvas.id));
			if (
				!current ||
				current.snapshot !== canvas.snapshot ||
				current.snapshotUpdatedAt !== canvas.snapshotUpdatedAt
			)
				throw new Error(
					`Canvas ${canvas.id} changed during migration. Stop writers and rerun.`,
				);
			await tx.insert(schema.canvasSyncRooms).values({
				canvasId: canvas.id,
				workspaceId: canvas.workspaceId,
				snapshot: snapshotJson,
				updatedAt: canvas.snapshotUpdatedAt,
			});
			await tx
				.update(schema.canvases)
				.set({ snapshot })
				.where(eq(schema.canvases.id, canvas.id));
		});
}
