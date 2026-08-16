import { describe, expect, it } from "bun:test";
import { createUseCaseTester } from "@beignet/core/application";
import {
	createTestContextFactory,
	createTestPorts,
	createTestTenant,
	createTestUserActor,
} from "@beignet/core/testing";
import { createInMemoryDevtools } from "@beignet/devtools";
import type { AppContext } from "@/app-context";
import {
	approveWaitlistUserUseCase,
	bootstrapAdminUseCase,
	listWaitlistUseCase,
} from "@/features/admin/use-cases";
import { appPorts } from "@/infra/port-wiring";
import type { AppTransactionPorts } from "@/ports";
import { ACCESS_STATUS_APPROVED, ADMIN_ROLE } from "@/ports/auth";
import { createTestAdminUserRepository, type SeedUser } from "./helpers";

// null → unauthenticated; otherwise the signed-in user's admin role.
type FixtureUser = { id?: string; role?: string | null } | null;

async function createAdminFixture(
	options: { user?: FixtureUser; seed?: SeedUser[] } = {},
) {
	const seed = options.seed ?? [];
	const userOption =
		options.user === undefined ? { role: ADMIN_ROLE } : options.user;
	const { repository, roleOf, statusOf } = createTestAdminUserRepository(seed);

	const fixture = createTestPorts<AppContext["ports"], AppTransactionPorts>({
		base: appPorts,
		overrides: {
			gate: appPorts.gate,
			adminUsers: repository,
			devtools: createInMemoryDevtools(),
		},
		transaction: {
			ports: (ports) => ({ ...ports, adminUsers: repository }),
		},
	});

	const auth = userOption
		? {
				user: {
					id: userOption.id ?? "user_admin",
					email: "admin@example.com",
					name: "Admin",
					accessStatus: ACCESS_STATUS_APPROVED,
					role: userOption.role ?? null,
				},
				session: {
					id: "session_admin",
					activeOrganizationId: null,
				},
			}
		: null;

	const createTestContext = createTestContextFactory<
		AppContext,
		AppContext["ports"]
	>({
		ports: fixture.ports,
		actor: createTestUserActor(auth?.user.id ?? "anon", {
			displayName: "Test",
		}),
		auth,
		tenant: createTestTenant("workspace_admin"),
	});
	const tester = createUseCaseTester<AppContext>(createTestContext);
	const ctx = await tester.ctx();

	return { tester, ctx, mailer: fixture.mailer, roleOf, statusOf };
}

describe("admin waitlist", () => {
	it("lists only waitlisted users, oldest first", async () => {
		const { tester, ctx } = await createAdminFixture({
			seed: [
				{
					id: "u_2",
					email: "second@example.com",
					createdAt: "2026-02-01T00:00:00.000Z",
				},
				{
					id: "u_1",
					email: "first@example.com",
					createdAt: "2026-01-01T00:00:00.000Z",
				},
				{
					id: "u_in",
					email: "already@example.com",
					accessStatus: ACCESS_STATUS_APPROVED,
				},
			],
		});

		const result = await tester.run(listWaitlistUseCase, {}, { ctx });

		expect(result.items.map((item) => item.email)).toEqual([
			"first@example.com",
			"second@example.com",
		]);
	});

	it("approves a waitlisted user, emails them, and returns them", async () => {
		const { tester, ctx, mailer, statusOf } = await createAdminFixture({
			seed: [{ id: "u_1", email: "invitee@example.com", name: "Invitee" }],
		});

		const result = await tester.run(
			approveWaitlistUserUseCase,
			{ userId: "u_1" },
			{ ctx },
		);

		expect(result.user.email).toBe("invitee@example.com");
		expect(statusOf("u_1")).toBe(ACCESS_STATUS_APPROVED);

		expect(mailer.deliveries).toHaveLength(1);
		const delivered = JSON.stringify(mailer.deliveries[0]?.message);
		expect(delivered).toContain("invitee@example.com");
		expect(delivered).toContain("/sign-in");
		expect(mailer.deliveries[0]?.message.subject).toMatch(/waitlist/i);
	});

	it("is idempotent: a second approval fails and sends no extra email", async () => {
		const { tester, ctx, mailer } = await createAdminFixture({
			seed: [{ id: "u_1", email: "invitee@example.com" }],
		});

		await tester.run(approveWaitlistUserUseCase, { userId: "u_1" }, { ctx });

		await expect(
			tester.run(approveWaitlistUserUseCase, { userId: "u_1" }, { ctx }),
		).rejects.toThrow(/No waitlisted user/i);

		expect(mailer.deliveries).toHaveLength(1);
	});

	it("rejects approving an unknown user without sending mail", async () => {
		const { tester, ctx, mailer } = await createAdminFixture({
			seed: [{ id: "u_1", email: "invitee@example.com" }],
		});

		await expect(
			tester.run(
				approveWaitlistUserUseCase,
				{ userId: "does_not_exist" },
				{ ctx },
			),
		).rejects.toThrow(/No waitlisted user/i);

		expect(mailer.deliveries).toHaveLength(0);
	});

	it("forbids a non-admin from listing or approving", async () => {
		const { tester, ctx, mailer, statusOf } = await createAdminFixture({
			user: { role: null },
			seed: [{ id: "u_1", email: "invitee@example.com" }],
		});

		await expect(tester.run(listWaitlistUseCase, {}, { ctx })).rejects.toThrow(
			/Admin access required/i,
		);
		await expect(
			tester.run(approveWaitlistUserUseCase, { userId: "u_1" }, { ctx }),
		).rejects.toThrow(/Admin access required/i);

		expect(statusOf("u_1")).not.toBe(ACCESS_STATUS_APPROVED);
		expect(mailer.deliveries).toHaveLength(0);
	});

	it("rejects an unauthenticated caller", async () => {
		const { tester, ctx } = await createAdminFixture({
			user: null,
			seed: [{ id: "u_1", email: "invitee@example.com" }],
		});

		await expect(tester.run(listWaitlistUseCase, {}, { ctx })).rejects.toThrow(
			/Authentication required/i,
		);
	});
});

describe("admin bootstrap", () => {
	it("promotes one verified waitlisted account", async () => {
		const { tester, ctx, roleOf, statusOf } = await createAdminFixture({
			user: null,
			seed: [{ id: "u_owner", email: "owner@example.com", name: "Owner" }],
		});

		const result = await tester.run(
			bootstrapAdminUseCase,
			{ email: " OWNER@example.com " },
			{ ctx },
		);

		expect(result).toEqual({
			status: "bootstrapped",
			user: {
				id: "u_owner",
				email: "owner@example.com",
				name: "Owner",
			},
		});
		expect(statusOf("u_owner")).toBe(ACCESS_STATUS_APPROVED);
		expect(roleOf("u_owner")).toBe(ADMIN_ROLE);
	});

	it("is idempotent for the configured administrator", async () => {
		const { tester, ctx } = await createAdminFixture({
			user: null,
			seed: [
				{
					id: "u_owner",
					email: "owner@example.com",
					name: "Owner",
					accessStatus: ACCESS_STATUS_APPROVED,
					role: ADMIN_ROLE,
				},
			],
		});

		const result = await tester.run(
			bootstrapAdminUseCase,
			{ email: "owner@example.com" },
			{ ctx },
		);

		expect(result.status).toBe("already-admin");
	});

	it("refuses to replace an existing administrator", async () => {
		const { tester, ctx, roleOf, statusOf } = await createAdminFixture({
			user: null,
			seed: [
				{
					id: "u_admin",
					email: "admin@example.com",
					accessStatus: ACCESS_STATUS_APPROVED,
					role: ADMIN_ROLE,
				},
				{ id: "u_owner", email: "owner@example.com" },
			],
		});

		const result = await tester.run(
			bootstrapAdminUseCase,
			{ email: "owner@example.com" },
			{ ctx },
		);

		expect(result).toEqual({ status: "admin-exists" });
		expect(statusOf("u_owner")).not.toBe(ACCESS_STATUS_APPROVED);
		expect(roleOf("u_owner")).toBeNull();
	});

	it("requires an OTP-verified account", async () => {
		const { tester, ctx, roleOf, statusOf } = await createAdminFixture({
			user: null,
			seed: [
				{
					id: "u_owner",
					email: "owner@example.com",
					emailVerified: false,
				},
			],
		});

		const result = await tester.run(
			bootstrapAdminUseCase,
			{ email: "owner@example.com" },
			{ ctx },
		);

		expect(result).toEqual({ status: "user-not-found" });
		expect(statusOf("u_owner")).not.toBe(ACCESS_STATUS_APPROVED);
		expect(roleOf("u_owner")).toBeNull();
	});
});
