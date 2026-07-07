import "@beignet/core/server-only";
import type { DrizzleSqliteDatabase } from "@beignet/provider-db-drizzle/sqlite";
import { eq } from "drizzle-orm";
import type {
	NewWaitlistEntry,
	WaitlistEntry,
	WaitlistRepository,
} from "@/features/waitlist/ports";
import * as schema from "@/infra/db/schema";

type WaitlistRow = typeof schema.waitlistEntries.$inferSelect;

function toWaitlistEntry(row: WaitlistRow): WaitlistEntry {
	return {
		id: row.id,
		email: row.email,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		lastRequestedAt: row.lastRequestedAt,
	};
}

export function createDrizzleWaitlistRepository(
	db: DrizzleSqliteDatabase<typeof schema>,
): WaitlistRepository {
	return {
		async hasAccount(email) {
			const [row] = await db
				.select({ id: schema.user.id })
				.from(schema.user)
				.where(eq(schema.user.email, email))
				.limit(1);

			return row !== undefined;
		},
		async join(input: NewWaitlistEntry) {
			const now = new Date().toISOString();
			const [row] = await db
				.insert(schema.waitlistEntries)
				.values({
					id: crypto.randomUUID(),
					email: input.email,
					createdAt: now,
					updatedAt: now,
					lastRequestedAt: now,
				})
				.onConflictDoUpdate({
					target: schema.waitlistEntries.email,
					set: {
						updatedAt: now,
						lastRequestedAt: now,
					},
				})
				.returning();

			if (!row) {
				throw new Error("Failed to join waitlist");
			}

			return toWaitlistEntry(row);
		},
	};
}

