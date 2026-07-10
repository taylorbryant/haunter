import type { CanvasRepository, NewCanvas } from "@/features/canvases/ports";
import type { Canvas } from "@/features/canvases/schemas";

export function createTestCanvasRepository(): CanvasRepository {
	const canvases = new Map<string, Canvas>();

	return {
		async findById(scope, id: string) {
			const canvas = canvases.get(id);
			return canvas?.workspaceId === tenantScopeId(scope) ? canvas : null;
		},
		async create(scope, input: NewCanvas) {
			const now = new Date().toISOString();
			const canvas: Canvas = {
				id: crypto.randomUUID(),
				userId: input.userId,
				workspaceId: tenantScopeId(scope),
				pageId: input.pageId,
				snapshot: {},
				createdAt: now,
				updatedAt: now,
			};
			canvases.set(canvas.id, canvas);
			return canvas;
		},
		async saveSnapshot(scope, id: string, snapshotJson: string) {
			const canvas = canvases.get(id);
			if (!canvas || canvas.workspaceId !== tenantScopeId(scope)) {
				throw new Error(`Canvas not found: ${id}`);
			}

			const updatedAt = new Date().toISOString();
			canvases.set(id, {
				...canvas,
				snapshot: JSON.parse(snapshotJson),
				updatedAt,
			});
			return { updatedAt };
		},
		async saveSnapshotIf(
			scope,
			id: string,
			snapshotJson: string,
			baseUpdatedAt: string,
		) {
			const canvas = canvases.get(id);
			if (!canvas || canvas.workspaceId !== tenantScopeId(scope)) {
				throw new Error(`Canvas not found: ${id}`);
			}
			if (canvas.updatedAt !== baseUpdatedAt) {
				return null;
			}

			// Strictly after the base version, mirroring the drizzle repo.
			const updatedAt = new Date(
				Math.max(Date.now(), Date.parse(baseUpdatedAt) + 1),
			).toISOString();
			canvases.set(id, {
				...canvas,
				snapshot: JSON.parse(snapshotJson),
				updatedAt,
			});
			return { updatedAt };
		},
		async deleteByPageIds(scope, pageIds: string[]) {
			for (const canvas of Array.from(canvases.values())) {
				if (
					canvas.workspaceId === tenantScopeId(scope) &&
					pageIds.includes(canvas.pageId)
				) {
					canvases.delete(canvas.id);
				}
			}
		},
	};
}
import { tenantScopeId } from "@beignet/core/ports";
