import { describe, expect, it } from "bun:test";
import { createUseCaseTester } from "@beignet/core/application";
import { createTestUserActor } from "@beignet/core/ports/testing";
import {
	createTestContextFactory,
	createTestPorts,
} from "@beignet/core/testing";
import { createInMemoryDevtools } from "@beignet/devtools";
import type { AppContext } from "@/app-context";
import type { PageRepository } from "@/features/pages/ports";
import {
	createTestPageLinkRepository,
	createTestPageRepository,
} from "@/features/pages/tests/helpers";
import { createTestTaskRepository } from "@/features/tasks/tests/helpers";
import type { WorkspaceRepository } from "@/features/workspaces/ports";
import { appPorts } from "@/infra/app-ports";
import type { AppTransactionPorts } from "@/ports";
import {
	createWorkspaceUseCase,
	deleteWorkspaceUseCase,
	listWorkspacesUseCase,
	onboardUserUseCase,
	updateWorkspaceUseCase,
} from "../use-cases";
import { createTestWorkspaceRepository } from "./helpers";

function createTester(
	userId: string,
	workspaces: WorkspaceRepository,
	pages: PageRepository = createTestPageRepository(),
) {
	const auth = {
		user: {
			id: userId,
			email: `${userId}@example.com`,
			name: "Test User",
		},
		session: { id: `session_${userId}` },
	};
	const pageLinks = createTestPageLinkRepository({ pages });
	const testFixture = createTestPorts<AppContext["ports"], AppTransactionPorts>(
		{
			base: appPorts,
			overrides: {
				gate: appPorts.gate,
				workspaces,
				pageLinks,
				pages,
				devtools: createInMemoryDevtools(),
			},
			transaction: {
				ports: (ports) => ({
					...ports,
					workspaces,
					pageLinks,
					pages,
				}),
			},
		},
	);
	const createTestContext = createTestContextFactory<
		AppContext,
		AppContext["ports"]
	>({
		ports: testFixture.ports,
		actor: createTestUserActor(auth.user.id, {
			displayName: auth.user.name,
		}),
		auth,
	});

	return createUseCaseTester<AppContext>(createTestContext);
}

describe("workspaces use cases", () => {
	it("creates, lists, updates, and deletes the signed-in user's workspaces", async () => {
		const workspaces = createTestWorkspaceRepository();
		const tester = createTester("user_test", workspaces);
		const ctx = await tester.ctx();

		const created = await tester.run(
			createWorkspaceUseCase,
			{ name: "Work" },
			{ ctx },
		);
		const second = await tester.run(
			createWorkspaceUseCase,
			{ name: "Personal", icon: "🏠" },
			{ ctx },
		);
		const updated = await tester.run(
			updateWorkspaceUseCase,
			{ id: created.id, name: "Job" },
			{ ctx },
		);
		const listed = await tester.run(listWorkspacesUseCase, {}, { ctx });

		expect(created.userId).toBe("user_test");
		expect(second.position).toBeGreaterThan(created.position);
		expect(updated.name).toBe("Job");
		expect(listed.items).toEqual([updated, second]);

		await tester.run(deleteWorkspaceUseCase, { id: created.id }, { ctx });
		const afterDelete = await tester.run(listWorkspacesUseCase, {}, { ctx });

		expect(afterDelete.items).toEqual([second]);
	});

	it("deletes the workspace's pages along with the workspace", async () => {
		const workspaces = createTestWorkspaceRepository();
		const pages = createTestPageRepository();
		const tester = createTester("user_test", workspaces, pages);
		const ctx = await tester.ctx();

		const workspace = await tester.run(
			createWorkspaceUseCase,
			{ name: "Work" },
			{ ctx },
		);
		await pages.create({
			userId: "user_test",
			workspaceId: workspace.id,
			parentPageId: null,
			title: "Notes",
			position: 1,
		});

		await tester.run(deleteWorkspaceUseCase, { id: workspace.id }, { ctx });

		expect(await pages.listMetaByWorkspace(workspace.id)).toEqual([]);
	});

	it("denies updates to workspaces owned by another user", async () => {
		const workspaces = createTestWorkspaceRepository();
		const owner = createTester("user_owner", workspaces);
		const intruder = createTester("user_intruder", workspaces);

		const ownerCtx = await owner.ctx();
		const created = await owner.run(
			createWorkspaceUseCase,
			{ name: "Owned" },
			{ ctx: ownerCtx },
		);

		const intruderCtx = await intruder.ctx();
		await expect(
			intruder.run(
				updateWorkspaceUseCase,
				{ id: created.id, name: "Mine now" },
				{ ctx: intruderCtx },
			),
		).rejects.toThrow("Only the owner can update this workspace.");
	});
});

function createOnboardFixture(userId = "user_new") {
	const workspaces = createTestWorkspaceRepository();
	const pages = createTestPageRepository();
	const tasks = createTestTaskRepository({ pages });
	const pageLinks = createTestPageLinkRepository({ pages });
	const testFixture = createTestPorts<AppContext["ports"], AppTransactionPorts>(
		{
			base: appPorts,
			overrides: {
				gate: appPorts.gate,
				workspaces,
				pages,
				tasks,
				pageLinks,
				devtools: createInMemoryDevtools(),
			},
			transaction: {
				ports: (ports) => ({ ...ports, workspaces, pages, tasks, pageLinks }),
			},
		},
	);
	const tester = createUseCaseTester<AppContext>(
		createTestContextFactory<AppContext, AppContext["ports"]>({
			ports: testFixture.ports,
			actor: createTestUserActor(userId, { displayName: "New User" }),
			auth: {
				user: { id: userId, email: `${userId}@example.com`, name: "New User" },
				session: { id: `session_${userId}` },
			},
		}),
	);

	return { tester, workspaces, pages, tasks };
}

describe("workspace onboarding", () => {
	it("seeds a first workspace with example pages and rolled-up tasks", async () => {
		const { tester, workspaces, pages, tasks } = createOnboardFixture();
		const ctx = await tester.ctx();

		const result = await tester.run(onboardUserUseCase, {}, { ctx });

		const workspaceList = await workspaces.listByUser("user_new");
		expect(workspaceList).toHaveLength(1);
		expect(result.workspaceId).toBe(workspaceList[0]?.id ?? "");
		expect(result.pageId).not.toBeNull();

		const seededPages = await pages.listMetaByWorkspace(result.workspaceId);
		expect(seededPages.map((page) => page.title)).toEqual([
			"Start here",
			"This week",
		]);
		expect(seededPages.every((page) => page.icon !== null)).toBe(true);
		// The welcome page is the one we return to land on.
		expect(seededPages.some((page) => page.id === result.pageId)).toBe(true);

		// Task blocks in the seeded pages reconcile into My Tasks.
		const rolledUp = await tasks.listByWorkspace(
			"user_new",
			result.workspaceId,
			"all",
		);
		expect(rolledUp.length).toBeGreaterThanOrEqual(4);
	});

	it("is idempotent: a user who already has a workspace is left unchanged", async () => {
		const { tester, workspaces, pages } = createOnboardFixture();
		const ctx = await tester.ctx();

		const first = await tester.run(onboardUserUseCase, {}, { ctx });
		const second = await tester.run(onboardUserUseCase, {}, { ctx });

		expect(second.workspaceId).toBe(first.workspaceId);
		expect(second.pageId).toBeNull();
		expect(await workspaces.listByUser("user_new")).toHaveLength(1);
		expect(await pages.listMetaByWorkspace(first.workspaceId)).toHaveLength(2);
	});
});
