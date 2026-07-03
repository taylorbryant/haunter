import type { CanvasRepository, NewCanvas } from "@/features/canvases/ports";
import type { Canvas } from "@/features/canvases/schemas";

export function createTestCanvasRepository(): CanvasRepository {
	const canvases = new Map<string, Canvas>();

	return {
		async findById(id: string) {
			return canvases.get(id) ?? null;
		},
		async create(input: NewCanvas) {
			const now = new Date().toISOString();
			const canvas: Canvas = {
				id: crypto.randomUUID(),
				userId: input.userId,
				workspaceId: input.workspaceId,
				pageId: input.pageId,
				snapshot: {},
				createdAt: now,
				updatedAt: now,
			};
			canvases.set(canvas.id, canvas);
			return canvas;
		},
		async saveSnapshot(id: string, snapshotJson: string) {
			const canvas = canvases.get(id);
			if (!canvas) {
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
		async deleteByPageIds(pageIds: string[]) {
			for (const canvas of Array.from(canvases.values())) {
				if (pageIds.includes(canvas.pageId)) {
					canvases.delete(canvas.id);
				}
			}
		},
	};
}
