import type { DrizzleSqliteDatabase } from "@beignet/provider-db-drizzle/sqlite";
import { and, eq, gt, lt } from "drizzle-orm";
import * as schema from "@/infra/db/schema";

const LEASE_MS = 30_000;
export function createWorkerLease(db: DrizzleSqliteDatabase<typeof schema>) {
	const ownerId = crypto.randomUUID();
	let expiresAt = 0;
	return {
		ownerId,
		valid: () => Date.now() < expiresAt,
		async acquire() {
			const now = Date.now();
			const [row] = await db
				.insert(schema.collaborationWorkerLease)
				.values({ id: 1, ownerId, expiresAt: now + LEASE_MS })
				.onConflictDoUpdate({
					target: schema.collaborationWorkerLease.id,
					set: { ownerId, expiresAt: now + LEASE_MS },
					setWhere: lt(schema.collaborationWorkerLease.expiresAt, now),
				})
				.returning();
			if (!row)
				throw new Error(
					"Another collaboration worker owns this database. Stop it before starting a replacement.",
				);
			expiresAt = row.expiresAt;
		},
		async renew() {
			const now = Date.now();
			const [row] = await db
				.update(schema.collaborationWorkerLease)
				.set({ expiresAt: now + LEASE_MS })
				.where(
					and(
						eq(schema.collaborationWorkerLease.id, 1),
						eq(schema.collaborationWorkerLease.ownerId, ownerId),
						gt(schema.collaborationWorkerLease.expiresAt, now),
					),
				)
				.returning();
			if (!row) {
				expiresAt = 0;
				throw new Error("Collaboration worker lease lost");
			}
			expiresAt = row.expiresAt;
		},
		async release() {
			expiresAt = 0;
			await db
				.delete(schema.collaborationWorkerLease)
				.where(
					and(
						eq(schema.collaborationWorkerLease.id, 1),
						eq(schema.collaborationWorkerLease.ownerId, ownerId),
					),
				);
		},
	};
}
