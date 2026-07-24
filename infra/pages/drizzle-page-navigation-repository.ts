import "@beignet/core/server-only";
import { tenantScopeId } from "@beignet/core/ports";
import type { DrizzleSqliteDatabase } from "@beignet/provider-db-drizzle/sqlite";
import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import type { PageNavigationRepository } from "@/features/pages/ports";
import type { PageNavigationItem } from "@/features/pages/schemas";
import * as schema from "@/infra/db/schema";
import { assertPageInScope } from "@/infra/db/tenant-scope";

const navigationColumns = {
	id: schema.pages.id,
	userId: schema.pages.userId,
	workspaceId: schema.pages.workspaceId,
	parentPageId: schema.pages.parentPageId,
	title: schema.pages.title,
	icon: schema.pages.icon,
	position: schema.pages.position,
	deletedAt: schema.pages.deletedAt,
	createdAt: schema.pages.createdAt,
	updatedAt: schema.pages.updatedAt,
	favoritedAt: schema.pageUserState.favoritedAt,
	lastViewedAt: schema.pageUserState.lastViewedAt,
};

function toNavigationItem(
	row: typeof navigationColumns extends Record<string, infer _Column>
		? Record<keyof typeof navigationColumns, unknown>
		: never,
): PageNavigationItem {
	return row as PageNavigationItem;
}

export function createDrizzlePageNavigationRepository(
	db: DrizzleSqliteDatabase<typeof schema>,
): PageNavigationRepository {
	function baseWhere(workspaceId: string, userId: string) {
		return and(
			eq(schema.pageUserState.workspaceId, workspaceId),
			eq(schema.pageUserState.userId, userId),
			eq(schema.pages.workspaceId, workspaceId),
			isNull(schema.pages.deletedAt),
		);
	}

	return {
		async listForUser(scope, userId, recentLimit) {
			const workspaceId = tenantScopeId(scope);
			const [favorites, recents] = await Promise.all([
				db
					.select(navigationColumns)
					.from(schema.pageUserState)
					.innerJoin(
						schema.pages,
						eq(schema.pages.id, schema.pageUserState.pageId),
					)
					.where(
						and(
							baseWhere(workspaceId, userId),
							isNotNull(schema.pageUserState.favoritedAt),
						),
					)
					.orderBy(desc(schema.pageUserState.favoritedAt)),
				db
					.select(navigationColumns)
					.from(schema.pageUserState)
					.innerJoin(
						schema.pages,
						eq(schema.pages.id, schema.pageUserState.pageId),
					)
					.where(
						and(
							baseWhere(workspaceId, userId),
							isNotNull(schema.pageUserState.lastViewedAt),
						),
					)
					.orderBy(desc(schema.pageUserState.lastViewedAt))
					.limit(recentLimit),
			]);

			return {
				favorites: favorites.map(toNavigationItem),
				recents: recents.map(toNavigationItem),
			};
		},
		async setFavorite(scope, userId, pageId, favorite) {
			const workspaceId = tenantScopeId(scope);
			await assertPageInScope(db, scope, pageId);
			const favoritedAt = favorite ? new Date().toISOString() : null;
			await db
				.insert(schema.pageUserState)
				.values({ userId, workspaceId, pageId, favoritedAt })
				.onConflictDoUpdate({
					target: [schema.pageUserState.userId, schema.pageUserState.pageId],
					set: { favoritedAt },
				});

			if (!favorite) {
				await db
					.delete(schema.pageUserState)
					.where(
						and(
							eq(schema.pageUserState.userId, userId),
							eq(schema.pageUserState.pageId, pageId),
							eq(schema.pageUserState.workspaceId, workspaceId),
							isNull(schema.pageUserState.favoritedAt),
							isNull(schema.pageUserState.lastViewedAt),
						),
					);
			}
			return favoritedAt;
		},
		async recordView(scope, userId, pageId) {
			const workspaceId = tenantScopeId(scope);
			await assertPageInScope(db, scope, pageId);
			const lastViewedAt = new Date().toISOString();
			await db
				.insert(schema.pageUserState)
				.values({ userId, workspaceId, pageId, lastViewedAt })
				.onConflictDoUpdate({
					target: [schema.pageUserState.userId, schema.pageUserState.pageId],
					set: { lastViewedAt },
				});
			return lastViewedAt;
		},
	};
}
