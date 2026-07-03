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
import type { WorkspaceRepository } from "@/features/workspaces/ports";
import { appPorts } from "@/infra/app-ports";
import type { AppTransactionPorts } from "@/ports";
import {
	createWorkspaceUseCase,
	deleteWorkspaceUseCase,
	listWorkspacesUseCase,
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
