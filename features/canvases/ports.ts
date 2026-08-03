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
	listIdsByPageIds(scope: TenantScope, pageIds: string[]): Promise<string[]>;
	deleteByPageIds(scope: TenantScope, pageIds: string[]): Promise<void>;
}
