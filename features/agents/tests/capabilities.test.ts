import { describe, expect, it } from "bun:test";
import { createBetterAuthAgentCapabilityTestContext } from "@beignet/agent-auth-better-auth/testing";
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
import type { NotificationRepository } from "@/features/notifications/ports";
import {
	createTestPageLinkRepository,
	createTestPageRepository,
	createTestPageVersionRepository,
	createTestWorkspaceEventPublisher,
} from "@/features/pages/tests/helpers";
import { createTestTaskRepository } from "@/features/tasks/tests/helpers";
import { appPorts } from "@/infra/app-ports";
import { createHaunterAgentAuthAdapter } from "@/lib/agent-auth-adapter";
import { agentCapabilities } from "@/lib/agent-capability-registry";
import type { AppTransactionPorts } from "@/ports";
import { ACCESS_STATUS_APPROVED } from "@/ports/auth";
import {
	createHaunterAgentCapabilityExecutor,
	executeAgentCapability,
} from "@/server/agent-capabilities";

async function createFixture() {
	const userId = "user_agent";
	const workspaceId = crypto.randomUUID().replaceAll("-", "");
	const pages = createTestPageRepository();
	const tasks = createTestTaskRepository({ pages });
	const canvases = createTestCanvasRepository();
	const pageLinks = createTestPageLinkRepository({ pages });
	const pageVersions = createTestPageVersionRepository();
	const workspaceEvents = createTestWorkspaceEventPublisher();
	const activities: AgentActivityWrite[] = [];
	const agents = createTestAgentAdminRepository([], activities);
	const members = {
		async findRole(candidateWorkspaceId: string, candidateUserId: string) {
			return candidateWorkspaceId === workspaceId && candidateUserId === userId
				? "owner"
				: null;
		},
		async listForUser() {
			return [{ id: workspaceId, name: "Test Workspace", role: "owner" }];
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
	const notificationInbox = {
		async resolveTaskNotifications() {},
		async dismissScheduledForTasks() {},
	} as unknown as NotificationRepository;
	const fixture = createTestPorts<AppContext["ports"], AppTransactionPorts>({
		base: appPorts,
		overrides: {
			agents,
			gate: appPorts.gate,
			canvases,
			members,
			notificationInbox,
			pageLinks,
			pages,
			pageVersions,
			tasks,
			workspaceEvents,
			devtools: createInMemoryDevtools(),
		},
		transaction: {
			ports: (ports) => ({
				...ports,
				agents,
				canvases,
				members,
				notificationInbox,
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
	const dependencies = {
		getServer: async () => server as never,
		getTimezone: async () => "UTC",
		now: () => new Date("2026-07-15T12:00:00.000Z"),
	};
	const execute = (capability: string, args: Record<string, unknown>) =>
		executeAgentCapability(
			{
				capability,
				arguments: args,
				agentSession: { agentId: "agent_test", userId },
			},
			dependencies,
		);

	return {
		activities,
		createExecutor: () => createHaunterAgentCapabilityExecutor(dependencies),
		execute,
		pages,
		scope: createTenantScope(createTestTenant(workspaceId)),
		tasks,
		userId,
		workspaceId,
	};
}

describe("Haunter agent capabilities", () => {
	it("requires workspace constraints on every workspace capability", async () => {
		const { createExecutor } = await createFixture();
		const adapter = createHaunterAgentAuthAdapter(createExecutor);
		if (!Array.isArray(adapter.capabilities)) {
			throw new Error("Expected a static Agent Auth capability catalog.");
		}

		for (const capability of adapter.capabilities) {
			expect(capability.requiredConstraints).toEqual(
				capability.name === "list_workspaces" ? undefined : ["workspaceId"],
			);
		}

		const createPage = adapter.capabilities.find(
			(capability) => capability.name === "create_page",
		);
		if (!createPage) throw new Error("Expected create_page capability.");
		if (!createPage.input) {
			throw new Error("Expected create_page input schema.");
		}
		const properties = createPage.input.properties as Record<
			string,
			{ description?: string }
		>;
		expect(createPage.description).toContain(
			"markdown must contain body content only",
		);
		expect(properties.title?.description).toContain(
			"displayed separately above the page body",
		);
		expect(properties.markdown?.description).toContain(
			"Do not repeat the page title",
		);
	});

	it("preserves grant authorization with activity lifecycle hooks", async () => {
		const { createExecutor, userId, workspaceId } = await createFixture();
		const adapter = createHaunterAgentAuthAdapter(createExecutor);
		if (!adapter.onExecute) throw new Error("Expected an Agent Auth executor.");

		const changedWorkspaceId = crypto.randomUUID().replaceAll("-", "");
		let workspaceReads = 0;
		const input = new Proxy(
			{ workspaceId, title: "Constraint test" },
			{
				get(target, property, receiver) {
					if (property === "workspaceId") {
						workspaceReads += 1;
						return workspaceReads === 1 ? workspaceId : changedWorkspaceId;
					}
					return Reflect.get(target, property, receiver);
				},
			},
		);

		await expect(
			adapter.onExecute(
				createBetterAuthAgentCapabilityTestContext({
					arguments: input,
					capability: "create_page",
					constraints: { workspaceId },
					agentId: "agent_test",
					userId,
				}),
			),
		).rejects.toThrow(
			'Constrained capability argument "workspaceId" changed during validation.',
		);
	});

	it("rejects stale broad grants after workspace constraints become required", async () => {
		const { createExecutor, userId, workspaceId } = await createFixture();
		let executorLoads = 0;
		const adapter = createHaunterAgentAuthAdapter(async () => {
			executorLoads += 1;
			return createExecutor();
		});
		if (!adapter.onExecute) throw new Error("Expected an Agent Auth executor.");

		await expect(
			adapter.onExecute(
				createBetterAuthAgentCapabilityTestContext({
					arguments: { workspaceId, title: "Constraint test" },
					capability: "create_page",
					constraints: null,
					agentId: "agent_test",
					userId,
				}),
			),
		).rejects.toThrow(
			'The active grant for capability "create_page" is missing required constraints: workspaceId.',
		);
		expect(executorLoads).toBe(0);
	});

	it("lists the acting user's workspaces", async () => {
		const { execute, workspaceId } = await createFixture();

		await expect(execute("list_workspaces", {})).resolves.toEqual({
			workspaces: [{ id: workspaceId, name: "Test Workspace", role: "owner" }],
		});
	});

	it("rejects malformed capability input before execution", async () => {
		const { execute, workspaceId } = await createFixture();

		await expect(execute("create_page", { workspaceId })).rejects.toMatchObject(
			{
				code: "invalid_input",
			},
		);
	});

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

	it("rejects oversized markdown before creating an agent page", async () => {
		const { execute, pages, scope, workspaceId } = await createFixture();
		const markdown = Array.from({ length: 10_001 }, () => "x").join("\n\n");

		await expect(
			execute("create_page", {
				workspaceId,
				title: "Too many blocks",
				markdown,
			}),
		).rejects.toMatchObject({ code: "INVALID_PAGE_CONTENT", status: 422 });
		expect(await pages.listMetaByWorkspace(scope)).toEqual([]);
	});

	it("rejects oversized markdown before appending to an agent page", async () => {
		const { execute, pages, scope, workspaceId } = await createFixture();
		const created = (await execute("create_page", {
			workspaceId,
			title: "Append target",
		})) as { pageId: string };
		const markdown = Array.from({ length: 10_001 }, () => "x").join("\n\n");

		await expect(
			execute("append_to_page", {
				workspaceId,
				pageId: created.pageId,
				markdown,
			}),
		).rejects.toMatchObject({ code: "INVALID_PAGE_CONTENT", status: 422 });
		expect((await pages.findById(scope, created.pageId))?.content).toEqual([]);
	});

	it("searches, reads, and appends page markdown", async () => {
		const { execute, workspaceId } = await createFixture();
		const created = (await execute("create_page", {
			workspaceId,
			title: "Searchable agent notes",
			markdown: "# Original",
		})) as { pageId: string };

		const searched = (await execute("search_pages", {
			workspaceId,
			query: "Searchable",
		})) as { pages: Array<{ pageId: string; title: string }> };
		const before = (await execute("read_page", {
			workspaceId,
			pageId: created.pageId,
		})) as { markdown: string };
		const appended = (await execute("append_to_page", {
			workspaceId,
			pageId: created.pageId,
			markdown: "Added paragraph",
		})) as { appendedBlocks: number };
		const after = (await execute("read_page", {
			workspaceId,
			pageId: created.pageId,
		})) as { markdown: string };

		expect(searched.pages).toContainEqual({
			pageId: created.pageId,
			title: "Searchable agent notes",
		});
		expect(before.markdown).toContain("# Original");
		expect(appended.appendedBlocks).toBe(1);
		expect(after.markdown).toContain("Added paragraph");
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
			dueTime: "14:00",
			reminderOffsetMinutes: 60,
		})) as {
			taskId: string;
			assigneeId: string | null;
			dueTime: string | null;
			reminderOffsetMinutes: number | null;
		};
		const listed = (await execute("list_tasks", { workspaceId })) as {
			tasks: Array<{
				taskId: string;
				title: string;
				dueTime: string | null;
				reminderOffsetMinutes: number | null;
			}>;
			hasMore: boolean;
		};
		const updated = (await execute("update_task", {
			workspaceId,
			taskId: created.taskId,
			title: "Prepare release notes",
			dueDate: null,
		})) as {
			title: string;
			dueDate: string | null;
			dueTime: string | null;
			reminderOffsetMinutes: number | null;
		};
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
		expect(created.dueTime).toBe("14:00");
		expect(created.reminderOffsetMinutes).toBe(60);
		expect(listed).toMatchObject({
			tasks: [
				expect.objectContaining({
					taskId: created.taskId,
					title: "Prepare launch notes",
					dueTime: "14:00",
					reminderOffsetMinutes: 60,
				}),
			],
			hasMore: false,
		});
		expect(updated).toMatchObject({
			title: "Prepare release notes",
			dueDate: null,
			dueTime: null,
			reminderOffsetMinutes: null,
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
