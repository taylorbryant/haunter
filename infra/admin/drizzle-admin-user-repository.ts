import "@beignet/core/server-only";
import type { DrizzleSqliteDatabase } from "@beignet/provider-db-drizzle/sqlite";
import { and, asc, eq } from "drizzle-orm";
import type { AdminUserRepository } from "@/features/admin/ports";
import type { WaitlistUser } from "@/features/admin/schemas";
import * as schema from "@/infra/db/schema";
import { ACCESS_STATUS_APPROVED, ACCESS_STATUS_WAITLISTED } from "@/ports/auth";

type UserRow = {
	id: string;
	email: string;
	name: string;
	createdAt: Date;
};

function toWaitlistUser(row: UserRow): WaitlistUser {
	return {
		id: row.id,
		email: row.email,
		name: row.name,
		createdAt: row.createdAt.toISOString(),
	};
}

const selection = {
	id: schema.user.id,
	email: schema.user.email,
	name: schema.user.name,
	createdAt: schema.user.createdAt,
} as const;

export function createDrizzleAdminUserRepository(
	db: DrizzleSqliteDatabase<typeof schema>,
): AdminUserRepository {
	return {
		async listWaitlisted() {
			const rows = await db
				.select(selection)
				.from(schema.user)
				.where(eq(schema.user.accessStatus, ACCESS_STATUS_WAITLISTED))
				.orderBy(asc(schema.user.createdAt));
			return rows.map(toWaitlistUser);
		},

		async approve(userId: string) {
			// Guard on the current status so the update is a no-op (empty
			// returning) for an already-approved or unknown user — the use-case
			// reads null as "nothing to do, don't email".
			const [row] = await db
				.update(schema.user)
				.set({ accessStatus: ACCESS_STATUS_APPROVED, updatedAt: new Date() })
				.where(
					and(
						eq(schema.user.id, userId),
						eq(schema.user.accessStatus, ACCESS_STATUS_WAITLISTED),
					),
				)
				.returning(selection);
			return row ? toWaitlistUser(row) : null;
		},
	};
}
