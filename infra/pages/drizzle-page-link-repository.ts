import "@beignet/core/server-only";
import type { DrizzleSqliteDatabase } from "@beignet/provider-db-drizzle/sqlite";
import { and, desc, eq, isNull } from "drizzle-orm";
import type { PageLinkRepository } from "@/features/pages/ports";
import * as schema from "@/infra/db/schema";

const metaColumns = {
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
};

export function createDrizzlePageLinkRepository(
	db: DrizzleSqliteDatabase<typeof schema>,
): PageLinkRepository {
	return {
		async replaceForSource(
			sourcePageId: string,
			userId: string,
			targetPageIds: string[],
		) {
			const current = await db
				.select({ targetPageId: schema.pageLinks.targetPageId })
				.from(schema.pageLinks)
				.where(eq(schema.pageLinks.sourcePageId, sourcePageId));
			const currentIds = current.map((row) => row.targetPageId).sort();
			const nextIds = [...targetPageIds].sort();

			if (
				currentIds.length === nextIds.length &&
				currentIds.every((id, index) => id === nextIds[index])
			) {
				return false;
			}

			await db
				.delete(schema.pageLinks)
				.where(eq(schema.pageLinks.sourcePageId, sourcePageId));

			if (targetPageIds.length === 0) return true;
			const createdAt = new Date().toISOString();
			await db.insert(schema.pageLinks).values(
				targetPageIds.map((targetPageId) => ({
					sourcePageId,
					targetPageId,
					userId,
					createdAt,
				})),
			);
			return true;
		},
		async listBacklinkSources(targetPageId: string) {
			const rows = await db
				.select(metaColumns)
				.from(schema.pageLinks)
				.innerJoin(
					schema.pages,
					eq(schema.pages.id, schema.pageLinks.sourcePageId),
				)
				.where(
					and(
						eq(schema.pageLinks.targetPageId, targetPageId),
						isNull(schema.pages.deletedAt),
					),
				)
				.orderBy(desc(schema.pages.updatedAt));

			return rows;
		},
	};
}
