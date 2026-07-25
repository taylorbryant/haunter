import "@beignet/core/server-only";
import type { DrizzleSqliteDatabase } from "@beignet/provider-db-drizzle/sqlite";
import { eq } from "drizzle-orm";
import type { ChangelogStateRepository } from "@/features/changelog/ports";
import * as schema from "@/infra/db/schema";

export function createDrizzleChangelogStateRepository(
	db: DrizzleSqliteDatabase<typeof schema>,
): ChangelogStateRepository {
	return {
		async getLastSeenVersion(userId) {
			const [row] = await db
				.select({ version: schema.changelogUserState.lastSeenVersion })
				.from(schema.changelogUserState)
				.where(eq(schema.changelogUserState.userId, userId))
				.limit(1);
			return row?.version ?? null;
		},
		async markSeen(userId, version) {
			const now = new Date().toISOString();
			await db
				.insert(schema.changelogUserState)
				.values({
					userId,
					lastSeenVersion: version,
					createdAt: now,
					updatedAt: now,
				})
				.onConflictDoUpdate({
					target: schema.changelogUserState.userId,
					set: { lastSeenVersion: version, updatedAt: now },
				});
		},
	};
}
