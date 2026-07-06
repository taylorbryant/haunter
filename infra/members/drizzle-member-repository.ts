import "@beignet/core/server-only";
import { createMemo } from "@beignet/core/memo";
import type { DrizzleSqliteDatabase } from "@beignet/provider-db-drizzle/sqlite";
import { and, eq } from "drizzle-orm";
import type { MemberRepository } from "@/features/members/ports";
import * as schema from "@/infra/db/schema";

export function createDrizzleMemberRepository(
	db: DrizzleSqliteDatabase<typeof schema>,
): MemberRepository {
	return {
		// Memoized per request: context creation resolves the caller's role for
		// the active workspace, and routes like liveblocks-auth look it up again
		// for the same (workspace, user) — one Turso round trip instead of two.
		// Role writes go through Better Auth's organization plugin, never this
		// repository, so there is no same-request mutation to invalidate for.
		findRole: createMemo(
			async (organizationId: string, userId: string) => {
				const [row] = await db
					.select({ role: schema.member.role })
					.from(schema.member)
					.where(
						and(
							eq(schema.member.organizationId, organizationId),
							eq(schema.member.userId, userId),
						),
					)
					.limit(1);

				return row?.role ?? null;
			},
			{ name: "members.findRole" },
		),
	};
}
