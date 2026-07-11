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
import type { AgentActivityWrite } from "@/features/agents/ports";
import { createTestAgentAdminRepository } from "@/features/agents/tests/helpers";
import { createTestCanvasRepository } from "@/features/canvases/tests/helpers";
import {
	createTestPageLinkRepository,
	createTestPageRepository,
	createTestPageVersionRepository,
} from "@/features/pages/tests/helpers";
import { createTestTaskRepository } from "@/features/tasks/tests/helpers";
import { appPorts } from "@/infra/app-ports";
import {
	agentCapabilities,
	executeAgentCapability,
} from "@/lib/agent-capabilities";
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
	const activities: AgentActivityWrite[] = [];
	const agents = createTestAgentAdminRepository([], activities);
	const members = {
		async findRole(candidateWorkspaceId: string, candidateUserId: string) {
			return candidateWorkspaceId === workspaceId && candidateUserId === userId
				? "owner"
				: null;
		},
		async listByWorkspace() {
			return [
				{
					userId,
					name: "Agent User",
					email: "agent@example.com",
					role: "owner",
				},
				{
					userId: "user_teammate",
					name: "Team Mate",
					email: "teammate@example.com",
					role: "member",
				},
			];
		},
	};
	const fixture = createTestPorts<AppContext["ports"], AppTransactionPorts>({
		base: appPorts,
		overrides: {
			agents,
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
				agents,
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
				agentSession: { agentId: "agent_test", userId },
			},
			{
				getServer: async () => server as never,
				getTimezone: async () => "UTC",
				now: () => new Date("2026-07-15T12:00:00.000Z"),
			},
		);

	return {
		activities,
		execute,
		pages,
		scope: createTenantScope(createTestTenant(workspaceId)),
		tasks,
		userId,
		workspaceId,
	};
}

describe("Haunter agent capabilities", () => {
	it("lists workspace members for task assignment", async () => {
		const { execute, userId, workspaceId } = await createFixture();

		const result = (await execute("list_workspace_members", {
			workspaceId,
		})) as {
			members: Array<{
				userId: string;
				name: string;
				email: string;
				role: string;
			}>;
		};

		expect(result.members).toEqual([
			{
				userId,
				name: "Agent User",
				email: "agent@example.com",
				role: "owner",
			},
			{
				userId: "user_teammate",
				name: "Team Mate",
				email: "teammate@example.com",
				role: "member",
			},
		]);
	});

	it("creates a page with markdown and returns it from list_pages", async () => {
		const { activities, execute, pages, scope, workspaceId } =
			await createFixture();

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
		expect(activities).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					capability: "create_page",
					status: "success",
					resourceType: "page",
					resourceId: created.pageId,
					resourceLabel: "Agent notes",
				}),
			]),
		);
	});

	it("updates page metadata and moves pages through the page use case", async () => {
		const { execute, pages, scope, workspaceId } = await createFixture();
		const parent = (await execute("create_page", {
			workspaceId,
			title: "Projects",
		})) as { pageId: string };
		const child = (await execute("create_page", {
			workspaceId,
			title: "Draft",
		})) as { pageId: string };

		const updated = (await execute("update_page", {
			workspaceId,
			pageId: child.pageId,
			title: "Launch plan",
			icon: "🚀",
			parentPageId: parent.pageId,
		})) as {
			pageId: string;
			title: string;
			icon: string | null;
			parentPageId: string | null;
		};

		expect(updated).toMatchObject({
			pageId: child.pageId,
			title: "Launch plan",
			icon: "🚀",
			parentPageId: parent.pageId,
		});
		expect(await pages.findMetaById(scope, child.pageId)).toMatchObject({
			title: "Launch plan",
			icon: "🚀",
			parentPageId: parent.pageId,
		});

		await expect(
			execute("update_page", {
				workspaceId,
				pageId: parent.pageId,
				parentPageId: child.pageId,
			}),
		).rejects.toMatchObject({ code: "INVALID_PAGE_MOVE" });
	});

	it("archives and restores page subtrees without exposing permanent purge", async () => {
		const { activities, execute, pages, scope, workspaceId } =
			await createFixture();
		const parent = (await execute("create_page", {
			workspaceId,
			title: "Archive me",
		})) as { pageId: string };
		const child = (await execute("create_page", {
			workspaceId,
			title: "Nested page",
			parentPageId: parent.pageId,
		})) as { pageId: string };

		const archived = (await execute("archive_page", {
			workspaceId,
			pageId: parent.pageId,
		})) as { pageId: string; title: string; archived: boolean };
		const archivedList = (await execute("list_pages", { workspaceId })) as {
			pages: Array<{ pageId: string }>;
		};

		expect(archived).toEqual({
			pageId: parent.pageId,
			title: "Archive me",
			archived: true,
		});
		expect(archivedList.pages).toEqual([]);
		expect(
			(await pages.findMetaById(scope, parent.pageId))?.deletedAt,
		).not.toBe(null);
		expect((await pages.findMetaById(scope, child.pageId))?.deletedAt).not.toBe(
			null,
		);

		const restored = (await execute("restore_page", {
			workspaceId,
			pageId: parent.pageId,
		})) as { pageId: string; title: string; restored: boolean };

		expect(restored).toMatchObject({
			pageId: parent.pageId,
			title: "Archive me",
			restored: true,
		});
		expect(
			(await pages.findMetaById(scope, parent.pageId))?.deletedAt,
		).toBeNull();
		expect(
			(await pages.findMetaById(scope, child.pageId))?.deletedAt,
		).toBeNull();
		expect(activities).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					capability: "archive_page",
					resourceType: "page",
					resourceId: parent.pageId,
					resourceLabel: "Archive me",
				}),
				expect.objectContaining({
					capability: "restore_page",
					resourceType: "page",
					resourceId: parent.pageId,
					resourceLabel: "Archive me",
				}),
			]),
		);
		expect(agentCapabilities.map(({ name }) => name)).not.toContain(
			"purge_page",
		);
		expect(agentCapabilities.map(({ name }) => name)).not.toContain(
			"delete_page",
		);
	});

	it("does not create pages for a user outside the workspace", async () => {
		const { activities, execute } = await createFixture();

		await expect(
			execute("create_page", {
				workspaceId: "another-workspace",
				title: "Unauthorized",
			}),
		).rejects.toMatchObject({ status: "FORBIDDEN" });
		expect(activities).toEqual([
			expect.objectContaining({
				capability: "create_page",
				status: "error",
				resourceType: "page",
				resourceLabel: "Unauthorized",
			}),
		]);
	});

	it("creates, lists, updates, and completes a task as the acting user", async () => {
		const { execute, tasks, scope, userId, workspaceId } =
			await createFixture();

		const created = (await execute("create_task", {
			workspaceId,
			title: "Prepare launch notes",
			dueDate: "2026-07-15",
		})) as { taskId: string; assigneeId: string | null };
		const listed = (await execute("list_tasks", { workspaceId })) as {
			tasks: Array<{ taskId: string; title: string }>;
			hasMore: boolean;
		};
		const updated = (await execute("update_task", {
			workspaceId,
			taskId: created.taskId,
			title: "Prepare release notes",
			dueDate: null,
		})) as { title: string; dueDate: string | null };
		const completed = (await execute("complete_task", {
			workspaceId,
			taskId: created.taskId,
		})) as { completed: boolean; completedAt: string | null };
		const completedStored = await tasks.findById(scope, created.taskId);
		const reopened = (await execute("reopen_task", {
			workspaceId,
			taskId: created.taskId,
		})) as { completed: boolean; completedAt: string | null };
		const deleted = (await execute("delete_task", {
			workspaceId,
			taskId: created.taskId,
		})) as { taskId: string; deleted: boolean };
		const stored = await tasks.findById(scope, created.taskId);

		expect(created.assigneeId).toBe(userId);
		expect(listed).toMatchObject({
			tasks: [
				expect.objectContaining({
					taskId: created.taskId,
					title: "Prepare launch notes",
				}),
			],
			hasMore: false,
		});
		expect(updated).toMatchObject({
			title: "Prepare release notes",
			dueDate: null,
		});
		expect(completed.completed).toBe(true);
		expect(completed.completedAt).not.toBeNull();
		expect(completedStored).toMatchObject({
			title: "Prepare release notes",
			completed: true,
			dueDate: null,
		});
		expect(reopened).toMatchObject({ completed: false, completedAt: null });
		expect(deleted).toEqual({ taskId: created.taskId, deleted: true });
		expect(stored).toBeNull();
	});

	it("filters tasks with timezone-aware due presets and explicit ranges", async () => {
		const { execute, workspaceId } = await createFixture();
		for (const [title, dueDate] of [
			["Overdue", "2026-07-14"],
			["Today", "2026-07-15"],
			["Upcoming", "2026-07-16"],
		] as const) {
			await execute("create_task", { workspaceId, title, dueDate });
		}
		await execute("create_task", { workspaceId, title: "Undated" });

		const titles = async (args: Record<string, unknown>) => {
			const result = (await execute("list_tasks", {
				workspaceId,
				...args,
			})) as { tasks: Array<{ title: string }> };
			return result.tasks.map((task) => task.title);
		};

		expect(await titles({ due: "overdue" })).toEqual(["Overdue"]);
		expect(await titles({ due: "today" })).toEqual(["Today"]);
		expect(await titles({ due: "upcoming" })).toEqual(["Upcoming"]);
		expect(
			await titles({ dueOnOrAfter: "2026-07-15", dueOnOrBefore: "2026-07-16" }),
		).toEqual(["Today", "Upcoming"]);
	});

	it("does not delete page-backed tasks", async () => {
		const { execute, workspaceId } = await createFixture();
		await execute("create_page", {
			workspaceId,
			title: "Protected tasks",
			markdown: "- [ ] Keep this task",
		});
		const listed = (await execute("list_tasks", {
			workspaceId,
			scope: "everyone",
		})) as { tasks: Array<{ taskId: string; pageId: string | null }> };
		const pageTask = listed.tasks.find((task) => task.pageId !== null);
		expect(pageTask).toBeDefined();

		await expect(
			execute("delete_task", {
				workspaceId,
				taskId: pageTask?.taskId,
			}),
		).rejects.toMatchObject({ code: "TASK_NOT_EDITABLE" });
	});
});
