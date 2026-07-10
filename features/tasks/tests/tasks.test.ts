import { describe, expect, it } from "bun:test";
import { createUseCaseTester } from "@beignet/core/application";
import { createTenantScope } from "@beignet/core/ports";
import {
	createTestTenant,
	createTestUserActor,
} from "@beignet/core/testing";
import {
	createTestContextFactory,
	createTestPorts,
} from "@beignet/core/testing";
import { createInMemoryDevtools } from "@beignet/devtools";
import type { AppContext } from "@/app-context";
import { extractPageSearchText } from "@/features/pages/lib/extract-page-text";
import type { BlockJson } from "@/features/pages/schemas";
import {
	createTestPageLinkRepository,
	createTestPageRepository,
	createTestPageVersionRepository,
} from "@/features/pages/tests/helpers";
import { savePageContentUseCase } from "@/features/pages/use-cases";
import { appPorts } from "@/infra/app-ports";
import type { AppTransactionPorts } from "@/ports";
import { ACCESS_STATUS_APPROVED } from "@/ports/auth";
import { AUTO_TASK_ASSIGNEE } from "../lib/task-block-props";
import {
	createTaskUseCase,
	deleteTaskUseCase,
	listTasksUseCase,
	updateTaskUseCase,
} from "../use-cases";
import { createTestTaskRepository } from "./helpers";

function taskBlock(
	id: string,
	text: string,
	props: Record<string, unknown> = {},
): BlockJson {
	return {
		id,
		type: "task",
		props: { checked: false, due: "", ...props },
		content: [{ type: "text", text, styles: {} }],
		children: [],
	};
}

async function createFixture(userId = "user_test") {
	const pages = createTestPageRepository();
	const tasks = createTestTaskRepository({ pages });
	// Better Auth org ids are nanoid-style, not UUIDs.
	const workspace = {
		id: crypto.randomUUID().replaceAll("-", ""),
		name: "Work",
	};
	const tenant = createTestTenant(workspace.id);
	const scope = createTenantScope(tenant);
	const page = await pages.create(scope, {
		userId,
		parentPageId: null,
		title: "Weekly notes",
		position: 1,
	});

	const auth = {
		user: {
			id: userId,
			email: `${userId}@example.com`,
			name: "Test User",
			accessStatus: ACCESS_STATUS_APPROVED,
		},
		session: { id: `session_${userId}`, activeOrganizationId: workspace.id },
	};
	const pageLinks = createTestPageLinkRepository({ pages });
	const pageVersions = createTestPageVersionRepository();
	// Workspace roster for assignee validation.
	const memberIds = new Set([userId, "user_teammate"]);
	const members = {
		async findRole(organizationId: string, candidateId: string) {
			return organizationId === workspace.id && memberIds.has(candidateId)
				? "member"
				: null;
		},
	};
	const fixture = createTestPorts<AppContext["ports"], AppTransactionPorts>({
		base: appPorts,
		overrides: {
			gate: appPorts.gate,
			members,
			pageLinks,
			pages,
			pageVersions,
			tasks,
			devtools: createInMemoryDevtools(),
		},
		transaction: {
			ports: (ports) => ({ ...ports, members, pages, pageVersions, tasks }),
		},
	});
	const createTestContext = createTestContextFactory<
		AppContext,
		AppContext["ports"]
	>({
		ports: fixture.ports,
		actor: createTestUserActor(auth.user.id, { displayName: auth.user.name }),
		auth,
		tenant,
		extra: { membership: { role: "owner" } },
	});
	const tester = createUseCaseTester<AppContext>(createTestContext);
	const ctx = await tester.ctx();

	return { pages, tasks, workspace, scope, page, tester, ctx };
}

describe("task reconciliation on page content save", () => {
	it("creates task rows for new task blocks", async () => {
		const { tasks, scope, page, tester, ctx } = await createFixture();

		await tester.run(
			savePageContentUseCase,
			{
				id: page.id,
				content: [
					taskBlock("b1", "Ship the tasks feature", { due: "2026-07-03" }),
					taskBlock("b2", "Already done", { checked: true }),
				],
			},
			{ ctx },
		);

		const rows = await tasks.listByWorkspace(scope, "all");
		expect(rows).toHaveLength(2);

		const shipped = rows.find((row) => row.sourceBlockId === "b1");
		expect(shipped?.title).toBe("Ship the tasks feature");
		expect(shipped?.dueDate).toBe("2026-07-03");
		expect(shipped?.completed).toBe(false);
		expect(shipped?.pageTitle).toBe("Weekly notes");

		const done = rows.find((row) => row.sourceBlockId === "b2");
		expect(done?.completed).toBe(true);
		expect(done?.completedAt).not.toBeNull();
	});

	it("updates changed rows and stamps completedAt only on transitions", async () => {
		const { tasks, scope, page, tester, ctx } = await createFixture();

		await tester.run(
			savePageContentUseCase,
			{ id: page.id, content: [taskBlock("b1", "Task", { checked: true })] },
			{ ctx },
		);
		const [first] = await tasks.listByWorkspace(scope, "all");
		const stampedAt = first?.completedAt;
		expect(stampedAt).not.toBeNull();

		// Save again with only the title changed: completedAt must not move.
		await tester.run(
			savePageContentUseCase,
			{
				id: page.id,
				content: [taskBlock("b1", "Task renamed", { checked: true })],
			},
			{ ctx },
		);
		const [renamed] = await tasks.listByWorkspace(scope, "all");
		expect(renamed?.title).toBe("Task renamed");
		expect(renamed?.completedAt).toBe(stampedAt ?? null);

		// Unchecking clears completedAt.
		await tester.run(
			savePageContentUseCase,
			{
				id: page.id,
				content: [taskBlock("b1", "Task renamed", { checked: false })],
			},
			{ ctx },
		);
		const [reopened] = await tasks.listByWorkspace(scope, "all");
		expect(reopened?.completed).toBe(false);
		expect(reopened?.completedAt).toBeNull();
	});

	it("deletes rows whose blocks were removed, leaving standalone tasks alone", async () => {
		const { tasks, workspace, scope, page, tester, ctx } =
			await createFixture();

		const standalone = await tester.run(
			createTaskUseCase,
			{ workspaceId: workspace.id, title: "Standalone" },
			{ ctx },
		);
		await tester.run(
			savePageContentUseCase,
			{ id: page.id, content: [taskBlock("b1", "Doomed")] },
			{ ctx },
		);

		await tester.run(
			savePageContentUseCase,
			{ id: page.id, content: [] },
			{ ctx },
		);

		const rows = await tasks.listByWorkspace(scope, "all");
		expect(rows.map((row) => row.id)).toEqual([standalone.id]);
	});

	it("does not modify the saved document", async () => {
		const { pages, scope, page, tester, ctx } = await createFixture();
		const content = [taskBlock("b1", "Task")];

		await tester.run(savePageContentUseCase, { id: page.id, content }, { ctx });

		const saved = await pages.findById(scope, page.id);
		expect(saved?.content).toEqual(content);
	});

	it("rejects invalid page-derived task props", async () => {
		const { tasks, scope, page, tester, ctx } = await createFixture();

		await expect(
			tester.run(
				savePageContentUseCase,
				{
					id: page.id,
					content: [taskBlock("bad-due", "Bad due", { due: "tomorrow" })],
				},
				{ ctx },
			),
		).rejects.toThrow("Task due dates must be YYYY-MM-DD.");

		await expect(
			tester.run(
				savePageContentUseCase,
				{
					id: page.id,
					content: [
						taskBlock("bad-assignee", "Bad assignee", {
							assignee: "user_stranger",
						}),
					],
				},
				{ ctx },
			),
		).rejects.toThrow("Task assignees must be members");

		expect(await tasks.listByWorkspace(scope, "all")).toHaveLength(0);
	});
});

describe("tasks use cases", () => {
	it("writes My Tasks toggles through to the source page document", async () => {
		const { pages, tasks, scope, page, tester, ctx } = await createFixture();

		await tester.run(
			savePageContentUseCase,
			{ id: page.id, content: [taskBlock("b1", "Toggle me")] },
			{ ctx },
		);
		const [row] = await tasks.listByWorkspace(scope, "all");
		if (!row) throw new Error("Expected a task row.");

		const updated = await tester.run(
			updateTaskUseCase,
			{ id: row.id, completed: true, dueDate: "2026-07-04" },
			{ ctx },
		);

		expect(updated.completed).toBe(true);
		expect(updated.completedAt).not.toBeNull();

		const saved = await pages.findById(scope, page.id);
		expect(saved?.content[0]?.props).toEqual({
			checked: true,
			due: "2026-07-04",
		});
	});

	it("does not let a stale page save revert task-list write-through changes", async () => {
		const { pages, tasks, scope, page, tester, ctx } = await createFixture();
		const staleEditorContent = [taskBlock("b1", "Toggle me")];

		const firstSave = await tester.run(
			savePageContentUseCase,
			{ id: page.id, content: staleEditorContent },
			{ ctx },
		);
		const [row] = await tasks.listByWorkspace(scope, "all");
		if (!row) throw new Error("Expected a task row.");

		await tester.run(
			updateTaskUseCase,
			{ id: row.id, completed: true, dueDate: "2026-07-04" },
			{ ctx },
		);

		await expect(
			tester.run(
				savePageContentUseCase,
				{
					id: page.id,
					content: staleEditorContent,
					baseUpdatedAt: firstSave.updatedAt,
				},
				{ ctx },
			),
		).rejects.toThrow(/changed since/);

		const saved = await pages.findById(scope, page.id);
		expect(saved?.content[0]?.props).toEqual({
			checked: true,
			due: "2026-07-04",
		});
	});

	it("rejects title edits and deletion for page-sourced tasks", async () => {
		const { tasks, scope, page, tester, ctx } = await createFixture();

		await tester.run(
			savePageContentUseCase,
			{ id: page.id, content: [taskBlock("b1", "Page task")] },
			{ ctx },
		);
		const [row] = await tasks.listByWorkspace(scope, "all");
		if (!row) throw new Error("Expected a task row.");

		await expect(
			tester.run(
				updateTaskUseCase,
				{ id: row.id, title: "New title" },
				{ ctx },
			),
		).rejects.toThrow(/edit it in the editor/);
		await expect(
			tester.run(deleteTaskUseCase, { id: row.id }, { ctx }),
		).rejects.toThrow(/edit it in the editor/);
	});

	it("tolerates a stale row whose block no longer exists", async () => {
		const { pages, tasks, scope, page, tester, ctx } = await createFixture();

		await tester.run(
			savePageContentUseCase,
			{ id: page.id, content: [taskBlock("b1", "Soon gone")] },
			{ ctx },
		);
		const [row] = await tasks.listByWorkspace(scope, "all");
		if (!row) throw new Error("Expected a task row.");

		// Simulate the block disappearing without a reconciling save.
		await pages.saveContent(scope, page.id, "[]", extractPageSearchText([]));

		const updated = await tester.run(
			updateTaskUseCase,
			{ id: row.id, completed: true },
			{ ctx },
		);
		expect(updated.completed).toBe(true);
	});

	it("supports the standalone task lifecycle and filters", async () => {
		const { workspace, tester, ctx } = await createFixture();

		const task = await tester.run(
			createTaskUseCase,
			{
				workspaceId: workspace.id,
				title: "Buy groceries",
				dueDate: "2026-07-05",
			},
			{ ctx },
		);
		expect(task.pageId).toBeNull();

		const renamed = await tester.run(
			updateTaskUseCase,
			{ id: task.id, title: "Buy groceries and coffee" },
			{ ctx },
		);
		expect(renamed.title).toBe("Buy groceries and coffee");

		await tester.run(
			updateTaskUseCase,
			{ id: task.id, completed: true },
			{ ctx },
		);

		const open = await tester.run(
			listTasksUseCase,
			{ workspaceId: workspace.id, filter: "open" },
			{ ctx },
		);
		const completed = await tester.run(
			listTasksUseCase,
			{ workspaceId: workspace.id, filter: "completed" },
			{ ctx },
		);
		expect(open.items).toHaveLength(0);
		expect(completed.items).toHaveLength(1);
		expect(completed.hasMore).toBe(false);

		await tester.run(deleteTaskUseCase, { id: task.id }, { ctx });
		const all = await tester.run(
			listTasksUseCase,
			{ workspaceId: workspace.id, filter: "all" },
			{ ctx },
		);
		expect(all.items).toHaveLength(0);
	});

	it("treats a task in another workspace as not found", async () => {
		const { workspace, tester, ctx, pages, tasks } = await createFixture();

		const task = await tester.run(
			createTaskUseCase,
			{ workspaceId: workspace.id, title: "Mine" },
			{ ctx },
		);

		// A member whose active workspace is a different tenant is denied.
		const intruderWorkspaceId = crypto.randomUUID();
		const intruderAuth = {
			user: {
				id: "user_intruder",
				email: "user_intruder@example.com",
				name: "Intruder",
				accessStatus: ACCESS_STATUS_APPROVED,
			},
			session: {
				id: "session_intruder",
				activeOrganizationId: intruderWorkspaceId,
			},
		};
		const pageVersions = createTestPageVersionRepository();
		const fixture = createTestPorts<AppContext["ports"], AppTransactionPorts>({
			base: appPorts,
			overrides: {
				gate: appPorts.gate,
				pageLinks: createTestPageLinkRepository({ pages }),
				pages,
				tasks,
				devtools: createInMemoryDevtools(),
			},
			transaction: {
				ports: (ports) => ({ ...ports, pages, pageVersions, tasks }),
			},
		});
		const intruder = createUseCaseTester<AppContext>(
			createTestContextFactory<AppContext, AppContext["ports"]>({
				ports: fixture.ports,
				actor: createTestUserActor("user_intruder", {
					displayName: "Intruder",
				}),
				auth: intruderAuth,
				tenant: createTestTenant(intruderWorkspaceId),
				extra: { membership: { role: "owner" } },
			}),
		);
		const intruderCtx = await intruder.ctx();

		await expect(
			intruder.run(
				updateTaskUseCase,
				{ id: task.id, completed: true },
				{ ctx: intruderCtx },
			),
		).rejects.toThrow("Task not found");
	});
});

describe("task assignment", () => {
	it("quick-add assigns the creator by default and accepts explicit assignees", async () => {
		const { workspace, tester, ctx } = await createFixture();

		const mine = await tester.run(
			createTaskUseCase,
			{ workspaceId: workspace.id, title: "For me" },
			{ ctx },
		);
		expect(mine.assigneeId).toBe("user_test");

		const teammate = await tester.run(
			createTaskUseCase,
			{
				workspaceId: workspace.id,
				title: "For teammate",
				assigneeId: "user_teammate",
			},
			{ ctx },
		);
		expect(teammate.assigneeId).toBe("user_teammate");

		const unassigned = await tester.run(
			createTaskUseCase,
			{ workspaceId: workspace.id, title: "For anyone", assigneeId: null },
			{ ctx },
		);
		expect(unassigned.assigneeId).toBeNull();
	});

	it("assigns new auto-assignee page task blocks to the saver", async () => {
		const { tasks, scope, page, tester, ctx } = await createFixture();

		await tester.run(
			savePageContentUseCase,
			{
				id: page.id,
				content: [
					taskBlock("b-auto", "Mine from the editor", {
						assignee: AUTO_TASK_ASSIGNEE,
					}),
				],
			},
			{ ctx },
		);
		let [row] = await tasks.listByPage(scope, page.id);
		expect(row.assigneeId).toBe("user_test");

		await tester.run(
			savePageContentUseCase,
			{
				id: page.id,
				content: [
					taskBlock("b-auto", "Mine from the editor, renamed", {
						assignee: AUTO_TASK_ASSIGNEE,
					}),
				],
			},
			{ ctx },
		);
		[row] = await tasks.listByPage(scope, page.id);
		expect(row.assigneeId).toBe("user_test");

		await tester.run(
			savePageContentUseCase,
			{
				id: page.id,
				content: [
					taskBlock("b-auto", "Mine from the editor, renamed", {
						assignee: "",
					}),
				],
			},
			{ ctx },
		);
		[row] = await tasks.listByPage(scope, page.id);
		expect(row.assigneeId).toBeNull();
	});

	it("rejects assigning to a non-member", async () => {
		const { workspace, tester, ctx } = await createFixture();

		await expect(
			tester.run(
				createTaskUseCase,
				{
					workspaceId: workspace.id,
					title: "Nope",
					assigneeId: "user_stranger",
				},
				{ ctx },
			),
		).rejects.toThrow("not a member");

		const task = await tester.run(
			createTaskUseCase,
			{ workspaceId: workspace.id, title: "Mine" },
			{ ctx },
		);
		await expect(
			tester.run(
				updateTaskUseCase,
				{ id: task.id, assigneeId: "user_stranger" },
				{ ctx },
			),
		).rejects.toThrow("not a member");
	});

	it("write-through: assigning from the list updates the source block", async () => {
		const { pages, tasks, scope, page, tester, ctx } = await createFixture();

		await tester.run(
			savePageContentUseCase,
			{ id: page.id, content: [taskBlock("b-assign", "Shared work")] },
			{ ctx },
		);
		const [row] = await tasks.listByPage(scope, page.id);
		expect(row.assigneeId).toBeNull();

		await tester.run(
			updateTaskUseCase,
			{ id: row.id, assigneeId: "user_teammate" },
			{ ctx },
		);

		const updated = await tasks.findById(scope, row.id);
		expect(updated?.assigneeId).toBe("user_teammate");
		const doc = await pages.findById(scope, page.id);
		const block = doc?.content.find((candidate) => candidate.id === "b-assign");
		expect(block?.props.assignee).toBe("user_teammate");
	});

	it("reconciles the assignee from block props on save", async () => {
		const { tasks, scope, page, tester, ctx } = await createFixture();

		await tester.run(
			savePageContentUseCase,
			{
				id: page.id,
				content: [
					taskBlock("b-owned", "Theirs", { assignee: "user_teammate" }),
				],
			},
			{ ctx },
		);
		let [row] = await tasks.listByPage(scope, page.id);
		expect(row.assigneeId).toBe("user_teammate");

		// Clearing the prop unassigns the row.
		await tester.run(
			savePageContentUseCase,
			{ id: page.id, content: [taskBlock("b-owned", "Theirs")] },
			{ ctx },
		);
		[row] = await tasks.listByPage(scope, page.id);
		expect(row.assigneeId).toBeNull();
	});

	it("lists tasks with server-side scope and limits", async () => {
		const { pages, workspace, scope, tester, ctx } = await createFixture();

		// A page created by a different member; its reconciled task rows carry
		// that member as creator.
		const theirPage = await pages.create(scope, {
			userId: "user_teammate",
			parentPageId: null,
			title: "Teammate notes",
			position: 2,
		});
		await tester.run(
			savePageContentUseCase,
			{ id: theirPage.id, content: [taskBlock("b-theirs", "Their task")] },
			{ ctx },
		);
		await tester.run(
			createTaskUseCase,
			{ workspaceId: workspace.id, title: "My quick-add" },
			{ ctx },
		);

		const listed = await tester.run(
			listTasksUseCase,
			{ workspaceId: workspace.id, filter: "all" },
			{ ctx },
		);
		const titles = listed.items.map((item) => item.title).sort();
		expect(titles).toEqual(["My quick-add", "Their task"]);

		const mine = await tester.run(
			listTasksUseCase,
			{ workspaceId: workspace.id, filter: "all", scope: "mine" },
			{ ctx },
		);
		expect(mine.items.map((item) => item.title)).toEqual(["My quick-add"]);

		const firstPage = await tester.run(
			listTasksUseCase,
			{ workspaceId: workspace.id, filter: "all", limit: 1 },
			{ ctx },
		);
		expect(firstPage.items).toHaveLength(1);
		expect(firstPage.hasMore).toBe(true);

		await tester.run(
			createTaskUseCase,
			{
				workspaceId: workspace.id,
				title: "Due today",
				dueDate: "2026-07-09",
			},
			{ ctx },
		);
		await tester.run(
			createTaskUseCase,
			{
				workspaceId: workspace.id,
				title: "Due later",
				dueDate: "2026-07-10",
			},
			{ ctx },
		);

		const dueToday = await tester.run(
			listTasksUseCase,
			{
				workspaceId: workspace.id,
				filter: "open",
				scope: "mine",
				dueOnOrBefore: "2026-07-09",
			},
			{ ctx },
		);
		expect(dueToday.items.map((item) => item.title)).toEqual(["Due today"]);
	});
});
