import { describe, expect, it } from "bun:test";
import { createTenantScope } from "@beignet/core/ports";
import {
	createTestContextFactory,
	createTestPorts,
	createTestTenant,
	createTestUserActor,
} from "@beignet/core/testing";
import { createInMemoryDevtools } from "@beignet/devtools";
import type { AppContext } from "@/app-context";
import { createTestCanvasRepository } from "@/features/canvases/tests/helpers";
import {
	createTestPageLinkRepository,
	createTestPageRepository,
	createTestPageVersionRepository,
} from "@/features/pages/tests/helpers";
import { createTestTaskRepository } from "@/features/tasks/tests/helpers";
import { appPorts } from "@/infra/app-ports";
import { executeAgentCapability } from "@/lib/agent-capabilities";
import type { AppTransactionPorts } from "@/ports";
import { ACCESS_STATUS_APPROVED } from "@/ports/auth";

async function createFixture() {
	const userId = "user_agent";
	const workspaceId = crypto.randomUUID().replaceAll("-", "");
	const pages = createTestPageRepository();
	const tasks = createTestTaskRepository({ pages });
	const canvases = createTestCanvasRepository();
	const pageLinks = createTestPageLinkRepository({ pages });
	const pageVersions = createTestPageVersionRepository();
	const members = {
		async findRole(candidateWorkspaceId: string, candidateUserId: string) {
			return candidateWorkspaceId === workspaceId && candidateUserId === userId
				? "owner"
				: null;
		},
	};
	const fixture = createTestPorts<AppContext["ports"], AppTransactionPorts>({
		base: appPorts,
		overrides: {
			gate: appPorts.gate,
			canvases,
			members,
			pageLinks,
			pages,
			pageVersions,
			tasks,
			devtools: createInMemoryDevtools(),
		},
		transaction: {
			ports: (ports) => ({
				...ports,
				canvases,
				members,
				pageLinks,
				pages,
				pageVersions,
				tasks,
			}),
		},
	});
	const auth = {
		user: {
			id: userId,
			email: "agent@example.com",
			name: "Agent User",
			accessStatus: ACCESS_STATUS_APPROVED,
		},
		session: { id: "session_agent", activeOrganizationId: workspaceId },
	};
	const createContext = createTestContextFactory<
		AppContext,
		AppContext["ports"]
	>({
		ports: fixture.ports,
		actor: createTestUserActor(userId, { displayName: auth.user.name }),
		auth,
		tenant: createTestTenant(workspaceId),
		extra: { membership: { role: "owner" } },
	});
	const ctx = await createContext();
	const server = {
		ports: fixture.ports,
		async createServiceContext() {
			return ctx;
		},
	};
	const execute = (capability: string, args: Record<string, unknown>) =>
		executeAgentCapability(
			{
				capability,
				arguments: args,
				agentSession: { userId },
			},
			{ getServer: async () => server as never },
		);

	return {
		execute,
		pages,
		scope: createTenantScope(createTestTenant(workspaceId)),
		workspaceId,
	};
}

describe("Haunter agent capabilities", () => {
	it("creates a page with markdown and returns it from list_pages", async () => {
		const { execute, pages, scope, workspaceId } = await createFixture();

		const created = (await execute("create_page", {
			workspaceId,
			title: "Agent notes",
			markdown: "# Notes\n\nCreated by an agent.",
		})) as {
			pageId: string;
			title: string;
			updatedAt: string;
		};
		const listed = (await execute("list_pages", { workspaceId })) as {
			pages: Array<{ pageId: string; title: string }>;
		};
		const stored = await pages.findById(scope, created.pageId);

		expect(created.title).toBe("Agent notes");
		expect(listed.pages).toContainEqual(
			expect.objectContaining({
				pageId: created.pageId,
				title: "Agent notes",
			}),
		);
		expect(stored?.content).toHaveLength(2);
	});

	it("does not create pages for a user outside the workspace", async () => {
		const { execute } = await createFixture();

		await expect(
			execute("create_page", {
				workspaceId: "another-workspace",
				title: "Unauthorized",
			}),
		).rejects.toMatchObject({ status: "FORBIDDEN" });
	});
});
