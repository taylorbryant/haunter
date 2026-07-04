import "@beignet/core/server-only";
import type { DrizzleSqliteDatabase } from "@beignet/provider-db-drizzle/sqlite";
import { eq } from "drizzle-orm";
import type { NewPageShare, ShareRepository } from "@/features/shares/ports";
import type { PageShare } from "@/features/shares/schemas";
import * as schema from "@/infra/db/schema";

type ShareRow = typeof schema.pageShares.$inferSelect;

function toShare(row: ShareRow): PageShare {
	return {
		id: row.id,
		pageId: row.pageId,
		workspaceId: row.workspaceId,
		token: row.token,
		createdBy: row.createdBy,
		createdAt: row.createdAt,
	};
}

export function createDrizzleShareRepository(
	db: DrizzleSqliteDatabase<typeof schema>,
): ShareRepository {
	return {
		async findByPage(pageId: string) {
			const [row] = await db
				.select()
				.from(schema.pageShares)
				.where(eq(schema.pageShares.pageId, pageId))
				.limit(1);

			return row ? toShare(row) : null;
		},
		async findByToken(token: string) {
			const [row] = await db
				.select()
				.from(schema.pageShares)
				.where(eq(schema.pageShares.token, token))
				.limit(1);

			return row ? toShare(row) : null;
		},
		async create(input: NewPageShare) {
			const share = {
				id: crypto.randomUUID(),
				pageId: input.pageId,
				workspaceId: input.workspaceId,
				token: input.token,
				createdBy: input.createdBy,
				createdAt: new Date().toISOString(),
			};
			const [row] = await db
				.insert(schema.pageShares)
				.values(share)
				.returning();

			if (!row) {
				throw new Error("Failed to create page share");
			}

			return toShare(row);
		},
		async deleteByPage(pageId: string) {
			await db
				.delete(schema.pageShares)
				.where(eq(schema.pageShares.pageId, pageId));
		},
	};
}
