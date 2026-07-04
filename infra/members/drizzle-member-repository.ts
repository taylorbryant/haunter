import "@beignet/core/server-only";
import type { DrizzleSqliteDatabase } from "@beignet/provider-db-drizzle/sqlite";
import { and, eq } from "drizzle-orm";
import type { MemberRepository } from "@/features/members/ports";
import * as schema from "@/infra/db/schema";

export function createDrizzleMemberRepository(
	db: DrizzleSqliteDatabase<typeof schema>,
): MemberRepository {
	return {
		async findRole(organizationId: string, userId: string) {
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
	};
}
