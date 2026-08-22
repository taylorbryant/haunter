import { tenantScopeId } from "@beignet/core/ports";
import type {
	CanvasNavigationRepository,
	CanvasRepository,
	NewCanvas,
} from "@/features/canvases/ports";
import type { Canvas } from "@/features/canvases/schemas";

export function createTestCanvasRepository(): CanvasRepository {
	const canvases = new Map<string, Canvas>();

	return {
		async listStandalone(scope) {
			return Array.from(canvases.values())
				.filter(
					(canvas) =>
						canvas.workspaceId === tenantScopeId(scope) &&
						canvas.pageId === null,
				)
				.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
				.map(
					({ snapshot: _snapshot, snapshotUpdatedAt: _version, ...canvas }) =>
						canvas,
				);
		},
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
				title: input.title,
				snapshot: {},
				snapshotUpdatedAt: now,
				createdAt: now,
				updatedAt: now,
			};
			canvases.set(canvas.id, canvas);
			return canvas;
		},
		async updateTitle(scope, id: string, title: string) {
			const canvas = canvases.get(id);
			if (
				!canvas ||
				canvas.workspaceId !== tenantScopeId(scope) ||
				canvas.pageId !== null
			) {
				throw new Error(`Canvas not found: ${id}`);
			}
			const updated = {
				...canvas,
				title,
				updatedAt: new Date().toISOString(),
			};
			canvases.set(id, updated);
			return updated;
		},
		async saveSnapshot(scope, id: string, snapshotJson: string) {
			const canvas = canvases.get(id);
			if (!canvas || canvas.workspaceId !== tenantScopeId(scope)) {
				throw new Error(`Canvas not found: ${id}`);
			}

			const snapshotUpdatedAt = new Date(
				Math.max(
					Date.now(),
					Date.parse(canvas.updatedAt) + 1,
					Date.parse(canvas.snapshotUpdatedAt) + 1,
				),
			).toISOString();
			canvases.set(id, {
				...canvas,
				snapshot: JSON.parse(snapshotJson),
				snapshotUpdatedAt,
				updatedAt: snapshotUpdatedAt,
			});
			return { updatedAt: snapshotUpdatedAt, snapshotUpdatedAt };
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
			if (canvas.snapshotUpdatedAt !== baseUpdatedAt) {
				return null;
			}

			// Strictly after the base version, mirroring the drizzle repo.
			const snapshotUpdatedAt = new Date(
				Math.max(Date.now(), Date.parse(baseUpdatedAt) + 1),
			).toISOString();
			canvases.set(id, {
				...canvas,
				snapshot: JSON.parse(snapshotJson),
				snapshotUpdatedAt,
				updatedAt:
					canvas.updatedAt > snapshotUpdatedAt
						? canvas.updatedAt
						: snapshotUpdatedAt,
			});
			return {
				updatedAt:
					canvas.updatedAt > snapshotUpdatedAt
						? canvas.updatedAt
						: snapshotUpdatedAt,
				snapshotUpdatedAt,
			};
		},
		async delete(scope, id: string) {
			const canvas = canvases.get(id);
			if (
				canvas?.workspaceId === tenantScopeId(scope) &&
				canvas.pageId === null
			) {
				canvases.delete(id);
			}
		},
		async deleteByPageIds(scope, pageIds: string[]) {
			for (const canvas of Array.from(canvases.values())) {
				if (
					canvas.workspaceId === tenantScopeId(scope) &&
					canvas.pageId !== null &&
					pageIds.includes(canvas.pageId)
				) {
					canvases.delete(canvas.id);
				}
			}
		},
	};
}

export function createTestCanvasNavigationRepository(deps: {
	canvases: CanvasRepository;
}): CanvasNavigationRepository {
	const states = new Map<
		string,
		{
			workspaceId: string;
			favoritedAt: string | null;
			lastViewedAt: string | null;
		}
	>();
	let sequence = 0;
	const timestamp = () => {
		sequence += 1;
		return new Date(Date.now() + sequence).toISOString();
	};
	const key = (userId: string, canvasId: string) => `${userId}:${canvasId}`;

	return {
		async listForUser(scope, userId, recentLimit) {
			const canvases = await deps.canvases.listStandalone(scope);
			const items = canvases.flatMap((canvas) => {
				const state = states.get(key(userId, canvas.id));
				return state ? [{ ...canvas, ...state }] : [];
			});
			return {
				favorites: items
					.filter((item) => item.favoritedAt !== null)
					.sort((left, right) =>
						(right.favoritedAt ?? "").localeCompare(left.favoritedAt ?? ""),
					),
				recents: items
					.filter((item) => item.lastViewedAt !== null)
					.sort((left, right) =>
						(right.lastViewedAt ?? "").localeCompare(left.lastViewedAt ?? ""),
					)
					.slice(0, recentLimit),
			};
		},
		async setFavorite(scope, userId, canvasId, favorite) {
			const canvas = await deps.canvases.findById(scope, canvasId);
			if (!canvas || canvas.pageId !== null) {
				throw new Error(`Canvas not found: ${canvasId}`);
			}
			const stateKey = key(userId, canvasId);
			const current = states.get(stateKey);
			const favoritedAt = favorite ? timestamp() : null;
			if (!favorite && !current?.lastViewedAt) states.delete(stateKey);
			else {
				states.set(stateKey, {
					workspaceId: canvas.workspaceId,
					favoritedAt,
					lastViewedAt: current?.lastViewedAt ?? null,
				});
			}
			return favoritedAt;
		},
		async recordView(scope, userId, canvasId) {
			const canvas = await deps.canvases.findById(scope, canvasId);
			if (!canvas || canvas.pageId !== null) {
				throw new Error(`Canvas not found: ${canvasId}`);
			}
			const stateKey = key(userId, canvasId);
			const current = states.get(stateKey);
			const lastViewedAt = timestamp();
			states.set(stateKey, {
				workspaceId: canvas.workspaceId,
				favoritedAt: current?.favoritedAt ?? null,
				lastViewedAt,
			});
			return lastViewedAt;
		},
	};
}
