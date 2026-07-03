import type { Canvas } from "@/features/canvases/schemas";

export type NewCanvas = {
	userId: string;
	workspaceId: string;
	pageId: string;
};

export interface CanvasRepository {
	findById(id: string): Promise<Canvas | null>;
	create(input: NewCanvas): Promise<Canvas>;
	saveSnapshot(
		id: string,
		snapshotJson: string,
	): Promise<{ updatedAt: string }>;
	deleteByPageIds(pageIds: string[]): Promise<void>;
}
