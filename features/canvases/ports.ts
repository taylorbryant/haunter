import type { TenantScope } from "@beignet/core/ports";
import type { Canvas } from "@/features/canvases/schemas";

export type NewCanvas = {
	userId: string;
	pageId: string;
};

export interface CanvasRepository {
	findById(scope: TenantScope, id: string): Promise<Canvas | null>;
	create(scope: TenantScope, input: NewCanvas): Promise<Canvas>;
	saveSnapshot(
		scope: TenantScope,
		id: string,
		snapshotJson: string,
	): Promise<{ updatedAt: string }>;
	/** Compare-and-set variant; null when the row moved on (stale write). */
	saveSnapshotIf(
		scope: TenantScope,
		id: string,
		snapshotJson: string,
		baseUpdatedAt: string,
	): Promise<{ updatedAt: string } | null>;
	deleteByPageIds(scope: TenantScope, pageIds: string[]): Promise<void>;
}
