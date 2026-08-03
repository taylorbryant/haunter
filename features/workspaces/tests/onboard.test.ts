import { describe, expect, it } from "bun:test";
import { createUseCaseTester } from "@beignet/core/application";
import { createTenantScope } from "@beignet/core/ports";
import { createTestTenant, createTestUserActor } from "@beignet/core/testing";
import {
	createTestContextFactory,
	createTestPorts,
} from "@beignet/core/testing";
import { createInMemoryDevtools } from "@beignet/devtools";
import type { AppContext } from "@/app-context";
import { createTestCanvasRepository } from "@/features/canvases/tests/helpers";
import {
	createTestPageLinkRepository,
	createTestPageRepository,
} from "@/features/pages/tests/helpers";
import { createTestTaskRepository } from "@/features/tasks/tests/helpers";
import { appPorts } from "@/infra/app-ports";
import type { AppTransactionPorts } from "@/ports";
import {
	ACCESS_STATUS_APPROVED,
	ACCESS_STATUS_WAITLISTED,
	type AccessStatus,
} from "@/ports/auth";
import { onboardUserUseCase } from "../use-cases";

async function createFixture(
	role = "owner",
	accessStatus: AccessStatus = ACCESS_STATUS_APPROVED,
	hasMembership = true,
) {
	const pages = createTestPageRepository();
	const tasks = createTestTaskRepository({ pages });
	// Better Auth org ids are nanoid-style, not UUIDs.
	const workspaceId = crypto.randomUUID().replaceAll("-", "");
	const auth = {
		user: {
			id: "user_test",
			email: "user_test@example.com",
			name: "Test",
			accessStatus,
		},
		session: {
			id: "session_test",
			...(hasMembership ? { activeOrganizationId: workspaceId } : {}),
		},
	};
	const canvases = createTestCanvasRepository();
	const pageLinks = createTestPageLinkRepository({ pages });
	const fixture = createTestPorts<AppContext["ports"], AppTransactionPorts>({
		base: appPorts,
		overrides: {
			gate: appPorts.gate,
			canvases,
			pageLinks,
			pages,
			tasks,
			devtools: createInMemoryDevtools(),
		},
		transaction: {
			ports: (ports) => ({ ...ports, canvases, pageLinks, pages, tasks }),
		},
	});
	const createTestContext = createTestContextFactory<
		AppContext,
		AppContext["ports"]
	>({
		ports: fixture.ports,
		actor: createTestUserActor(auth.user.id, { displayName: "Test" }),
		auth,
		...(hasMembership
			? {
					tenant: createTestTenant(workspaceId),
					extra: { membership: { role } },
				}
			: {}),
	});
	const tester = createUseCaseTester<AppContext>(createTestContext);
	const ctx = await tester.ctx();
	const scope = createTenantScope(createTestTenant(workspaceId));

	return { pages, tasks, workspaceId, scope, tester, ctx };
}

describe("onboarding", () => {
	it("seeds an empty workspace and is a no-op on the next call", async () => {
		const { pages, workspaceId, scope, tester, ctx } = await createFixture();

		const first = await tester.run(onboardUserUseCase, {}, { ctx });
		expect(first.workspaceId).toBe(workspaceId);
		expect(first.pageId).not.toBeNull();

		const seeded = await pages.listMetaByWorkspace(scope);
		expect(seeded.length).toBeGreaterThan(0);

		const second = await tester.run(onboardUserUseCase, {}, { ctx });
		expect(second.pageId).toBeNull();
		expect(await pages.listMetaByWorkspace(scope)).toHaveLength(seeded.length);
	});

	it("does not re-seed a workspace whose pages are all trashed", async () => {
		const { pages, scope, tester, ctx } = await createFixture();

		const first = await tester.run(onboardUserUseCase, {}, { ctx });
		expect(first.pageId).not.toBeNull();

		// Trash everything, as a user clearing out the starter content would.
		const seeded = await pages.listMetaByWorkspace(scope);
		await pages.setDeletedByIds(
			scope,
			seeded.map((page) => page.id),
			new Date().toISOString(),
		);

		const again = await tester.run(onboardUserUseCase, {}, { ctx });
		expect(again.pageId).toBeNull();
		expect(await pages.listMetaByWorkspace(scope)).toHaveLength(0);
	});

	it("is a no-op for read-only members", async () => {
		const { pages, scope, tester, ctx } = await createFixture("viewer");

		const result = await tester.run(onboardUserUseCase, {}, { ctx });
		expect(result.pageId).toBeNull();
		expect(await pages.listMetaByWorkspace(scope)).toHaveLength(0);
	});

	it("blocks waitlisted users that have not been admitted to a workspace", async () => {
		const { tester, ctx } = await createFixture(
			"owner",
			ACCESS_STATUS_WAITLISTED,
			false,
		);

		await expect(tester.run(onboardUserUseCase, {}, { ctx })).rejects.toThrow(
			"still on the waitlist",
		);
	});
});
