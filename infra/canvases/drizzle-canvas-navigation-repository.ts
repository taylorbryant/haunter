import "@beignet/core/server-only";
import { tenantScopeId } from "@beignet/core/ports";
import type { DrizzleSqliteDatabase } from "@beignet/provider-db-drizzle/sqlite";
import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import type { CanvasNavigationRepository } from "@/features/canvases/ports";
import type { CanvasNavigationItem } from "@/features/canvases/schemas";
import * as schema from "@/infra/db/schema";
import { assertCanvasInScope } from "@/infra/db/tenant-scope";

const navigationColumns = {
	id: schema.canvases.id,
	userId: schema.canvases.userId,
	workspaceId: schema.canvases.workspaceId,
	pageId: schema.canvases.pageId,
	title: schema.canvases.title,
	createdAt: schema.canvases.createdAt,
	updatedAt: schema.canvases.updatedAt,
	favoritedAt: schema.canvasUserState.favoritedAt,
	lastViewedAt: schema.canvasUserState.lastViewedAt,
};

function toNavigationItem(
	row: typeof navigationColumns extends Record<string, infer _Column>
		? Record<keyof typeof navigationColumns, unknown>
		: never,
): CanvasNavigationItem {
	return row as CanvasNavigationItem;
}

export function createDrizzleCanvasNavigationRepository(
	db: DrizzleSqliteDatabase<typeof schema>,
): CanvasNavigationRepository {
	function baseWhere(workspaceId: string, userId: string) {
		return and(
			eq(schema.canvasUserState.workspaceId, workspaceId),
			eq(schema.canvasUserState.userId, userId),
			eq(schema.canvases.workspaceId, workspaceId),
			isNull(schema.canvases.pageId),
		);
	}

	return {
		async listForUser(scope, userId, recentLimit) {
			const workspaceId = tenantScopeId(scope);
			const [favorites, recents] = await Promise.all([
				db
					.select(navigationColumns)
					.from(schema.canvasUserState)
					.innerJoin(
						schema.canvases,
						eq(schema.canvases.id, schema.canvasUserState.canvasId),
					)
					.where(
						and(
							baseWhere(workspaceId, userId),
							isNotNull(schema.canvasUserState.favoritedAt),
						),
					)
					.orderBy(desc(schema.canvasUserState.favoritedAt)),
				db
					.select(navigationColumns)
					.from(schema.canvasUserState)
					.innerJoin(
						schema.canvases,
						eq(schema.canvases.id, schema.canvasUserState.canvasId),
					)
					.where(
						and(
							baseWhere(workspaceId, userId),
							isNotNull(schema.canvasUserState.lastViewedAt),
						),
					)
					.orderBy(desc(schema.canvasUserState.lastViewedAt))
					.limit(recentLimit),
			]);

			return {
				favorites: favorites.map(toNavigationItem),
				recents: recents.map(toNavigationItem),
			};
		},
		async setFavorite(scope, userId, canvasId, favorite) {
			const workspaceId = tenantScopeId(scope);
			await assertCanvasInScope(db, scope, canvasId);
			const favoritedAt = favorite ? new Date().toISOString() : null;
			await db
				.insert(schema.canvasUserState)
				.values({ userId, workspaceId, canvasId, favoritedAt })
				.onConflictDoUpdate({
					target: [
						schema.canvasUserState.userId,
						schema.canvasUserState.canvasId,
					],
					set: { favoritedAt },
				});

			if (!favorite) {
				await db
					.delete(schema.canvasUserState)
					.where(
						and(
							eq(schema.canvasUserState.userId, userId),
							eq(schema.canvasUserState.canvasId, canvasId),
							eq(schema.canvasUserState.workspaceId, workspaceId),
							isNull(schema.canvasUserState.favoritedAt),
							isNull(schema.canvasUserState.lastViewedAt),
						),
					);
			}
			return favoritedAt;
		},
		async recordView(scope, userId, canvasId) {
			const workspaceId = tenantScopeId(scope);
			await assertCanvasInScope(db, scope, canvasId);
			const lastViewedAt = new Date().toISOString();
			await db
				.insert(schema.canvasUserState)
				.values({ userId, workspaceId, canvasId, lastViewedAt })
				.onConflictDoUpdate({
					target: [
						schema.canvasUserState.userId,
						schema.canvasUserState.canvasId,
					],
					set: { lastViewedAt },
				});
			return lastViewedAt;
		},
	};
}
