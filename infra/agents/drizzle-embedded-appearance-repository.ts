import "@beignet/core/server-only";
import type { DrizzleSqliteDatabase } from "@beignet/provider-db-drizzle/sqlite";
import { eq } from "drizzle-orm";
import type { EmbeddedAppearanceRepository } from "@/features/agents/ports";
import { EmbeddedAppearanceSchema } from "@/features/agents/schemas";
import * as schema from "@/infra/db/schema";

export function createDrizzleEmbeddedAppearanceRepository(
	db: DrizzleSqliteDatabase<typeof schema>,
): EmbeddedAppearanceRepository {
	return {
		async get(userId) {
			const [row] = await db
				.select({ theme: schema.embeddedAppearance.theme })
				.from(schema.embeddedAppearance)
				.where(eq(schema.embeddedAppearance.userId, userId))
				.limit(1);
			return EmbeddedAppearanceSchema.safeParse(row).data ?? { theme: "host" };
		},
		async set(userId, { theme }) {
			await db
				.insert(schema.embeddedAppearance)
				.values({ userId, theme })
				.onConflictDoUpdate({
					target: schema.embeddedAppearance.userId,
					set: { theme },
				});
		},
	};
}
