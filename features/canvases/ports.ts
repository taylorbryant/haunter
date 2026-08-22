import type { TenantScope } from "@beignet/core/ports";
import type {
	Canvas,
	CanvasListItem,
	CanvasNavigationItem,
} from "@/features/canvases/schemas";

export type NewCanvas = {
	userId: string;
	pageId: string | null;
	title: string | null;
};

export interface CanvasRepository {
	listStandalone(scope: TenantScope): Promise<CanvasListItem[]>;
	findById(scope: TenantScope, id: string): Promise<Canvas | null>;
	create(scope: TenantScope, input: NewCanvas): Promise<Canvas>;
	updateTitle(scope: TenantScope, id: string, title: string): Promise<Canvas>;
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
	delete(scope: TenantScope, id: string): Promise<void>;
	deleteByPageIds(scope: TenantScope, pageIds: string[]): Promise<void>;
}

export interface CanvasNavigationRepository {
	listForUser(
		scope: TenantScope,
		userId: string,
		recentLimit: number,
	): Promise<{
		favorites: CanvasNavigationItem[];
		recents: CanvasNavigationItem[];
	}>;
	setFavorite(
		scope: TenantScope,
		userId: string,
		canvasId: string,
		favorite: boolean,
	): Promise<string | null>;
	recordView(
		scope: TenantScope,
		userId: string,
		canvasId: string,
	): Promise<string>;
}
