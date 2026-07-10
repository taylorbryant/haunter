import { describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { createDrizzleAdminUserRepository } from "@/infra/admin/drizzle-admin-user-repository";
import { createTestDatabase } from "@/infra/db/test-database";
import * as schema from "@/infra/db/schema";
import {
	ACCESS_STATUS_APPROVED,
	ACCESS_STATUS_WAITLISTED,
	ADMIN_ROLE,
} from "@/ports/auth";

describe("admin bootstrap repository", () => {
	it("atomically promotes one verified account and blocks a replacement", async () => {
		const testDatabase = await createTestDatabase();
		try {
			const now = new Date();
			await testDatabase.db.insert(schema.user).values([
				{
					id: "u_owner",
					name: "Owner",
					email: "owner@example.com",
					emailVerified: true,
					createdAt: now,
					updatedAt: now,
				},
				{
					id: "u_other",
					name: "Other",
					email: "other@example.com",
					emailVerified: true,
					createdAt: now,
					updatedAt: now,
				},
			]);

			const first = await testDatabase.db.transaction((tx) =>
				createDrizzleAdminUserRepository(tx).bootstrap("OWNER@example.com"),
			);
			expect(first.status).toBe("bootstrapped");

			const [owner] = await testDatabase.db
				.select({
					accessStatus: schema.user.accessStatus,
					role: schema.user.role,
				})
				.from(schema.user)
				.where(eq(schema.user.id, "u_owner"));
			expect(owner).toEqual({
				accessStatus: ACCESS_STATUS_APPROVED,
				role: ADMIN_ROLE,
			});

			const replacement = await testDatabase.db.transaction((tx) =>
				createDrizzleAdminUserRepository(tx).bootstrap("other@example.com"),
			);
			expect(replacement).toEqual({ status: "admin-exists" });

			const [other] = await testDatabase.db
				.select({
					accessStatus: schema.user.accessStatus,
					role: schema.user.role,
				})
				.from(schema.user)
				.where(eq(schema.user.id, "u_other"));
			expect(other).toEqual({
				accessStatus: ACCESS_STATUS_WAITLISTED,
				role: null,
			});
		} finally {
			await testDatabase.close();
		}
	});
});
