import { describe, expect, it } from "bun:test";
import { createTenant, createTenantScope } from "@beignet/core/ports";
import { eq } from "drizzle-orm";
import * as schema from "@/infra/db/schema";
import { createTestDatabase } from "@/infra/db/test-database";
import { createDrizzleMemberRepository } from "@/infra/members/drizzle-member-repository";

describe("workspace membership authority", () => {
	it("grants access only from a current member row", async () => {
		const database = await createTestDatabase();
		try {
			const now = new Date("2026-08-08T12:00:00.000Z");
			await database.db.insert(schema.user).values([
				{
					id: "user_inviter",
					name: "Workspace Owner",
					email: "owner@example.com",
					emailVerified: true,
					createdAt: now,
					updatedAt: now,
				},
				{
					id: "user_invitee",
					name: "Invited User",
					email: "invitee@example.com",
					emailVerified: true,
					createdAt: now,
					updatedAt: now,
				},
			]);
			await database.db.insert(schema.organization).values({
				id: "workspace_membership",
				name: "Membership Test",
				slug: "membership-test",
				createdAt: now,
			});
			await database.db.insert(schema.member).values({
				id: "member_inviter",
				organizationId: "workspace_membership",
				userId: "user_inviter",
				role: "owner",
				createdAt: now,
			});
			await database.db.insert(schema.invitation).values({
				id: "invitation_pending",
				organizationId: "workspace_membership",
				email: "invitee@example.com",
				role: "viewer",
				status: "pending",
				expiresAt: new Date("2026-08-15T12:00:00.000Z"),
				createdAt: now,
				inviterId: "user_inviter",
			});

			const pendingRepository = createDrizzleMemberRepository(database.db);
			expect(
				await pendingRepository.findRole(
					"workspace_membership",
					"user_invitee",
				),
			).toBeNull();
			expect(await pendingRepository.listForUser("user_invitee")).toEqual([]);
			expect(
				await pendingRepository.listByWorkspace(
					createTenantScope(createTenant("workspace_membership")),
				),
			).toEqual([
				expect.objectContaining({
					userId: "user_inviter",
					role: "owner",
				}),
			]);

			await database.db.insert(schema.member).values({
				id: "member_invitee",
				organizationId: "workspace_membership",
				userId: "user_invitee",
				role: "viewer",
				createdAt: now,
			});
			const acceptedRepository = createDrizzleMemberRepository(database.db);
			expect(
				await acceptedRepository.findRole(
					"workspace_membership",
					"user_invitee",
				),
			).toBe("viewer");
			expect(await acceptedRepository.listForUser("user_invitee")).toEqual([
				{
					id: "workspace_membership",
					name: "Membership Test",
					role: "viewer",
				},
			]);

			await database.db
				.delete(schema.member)
				.where(eq(schema.member.id, "member_invitee"));
			const revokedRepository = createDrizzleMemberRepository(database.db);
			expect(
				await revokedRepository.findRole(
					"workspace_membership",
					"user_invitee",
				),
			).toBeNull();
			expect(await revokedRepository.listForUser("user_invitee")).toEqual([]);
		} finally {
			await database.close();
		}
	});
});
