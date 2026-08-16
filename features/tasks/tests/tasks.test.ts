import { describe, expect, it } from "bun:test";
import { createUseCaseTester } from "@beignet/core/application";
import { createTenantScope } from "@beignet/core/ports";
import {
	createTestContextFactory,
	createTestPorts,
	createTestTenant,
	createTestUserActor,
} from "@beignet/core/testing";
import { createInMemoryDevtools } from "@beignet/devtools";
import type { AppContext } from "@/app-context";
import type { BlockJson } from "@/features/content/schemas";
import type {
	NotificationRepository,
	TaskAssignmentCandidate,
} from "@/features/notifications/ports";
import type { Notification } from "@/features/notifications/schemas";
import { extractPageSearchText } from "@/features/pages/lib/extract-page-text";
import {
	createTestPageLinkRepository,
	createTestPageRepository,
	createTestPageVersionRepository,
	createTestWorkspaceEventPublisher,
} from "@/features/pages/tests/helpers";
import {
	createPageUseCase,
	savePageContentUseCase,
} from "@/features/pages/use-cases";
import { appPorts } from "@/infra/port-wiring";
import type { AppTransactionPorts } from "@/ports";
import { ACCESS_STATUS_APPROVED } from "@/ports/auth";
import { AUTO_TASK_ASSIGNEE } from "../lib/task-block-props";
import { createTaskIntegrationPorts } from "../lib/task-integration-ports";
import { createTaskAssignmentDeliveryPort } from "../notifications/assigned";
import type { UpdateTaskData } from "../ports";
import { TASK_TITLE_MAX_LENGTH, TASK_TITLE_TOO_LONG_MESSAGE } from "../schemas";
import {
	actOnTaskNotificationUseCase,
	createTaskUseCase,
	deleteTaskUseCase,
	listTasksUseCase,
	updateTaskUseCase,
} from "../use-cases";
import { resolveSnoozedUntil } from "../use-cases/act-on-task-notification";
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

async function createFixture(
	userId = "user_test",
	options: { assignmentDeliveryFails?: boolean } = {},
) {
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
	const workspaceEvents = createTestWorkspaceEventPublisher();
	const assignmentNotifications: Notification[] = [];
	const dismissedScheduledTaskIds: string[] = [];
	const afterResponseTasks: Array<() => Promise<void>> = [];
	const pushDeliveries: unknown[] = [];
	const afterResponse = {
		schedule(work: () => Promise<void>) {
			afterResponseTasks.push(work);
		},
	};
	const notificationInbox = {
		async findByUser(candidateUserId: string, id: string) {
			const notification = assignmentNotifications.find(
				(item) => item.id === id && item.userId === candidateUserId,
			);
			if (!notification) return null;
			const task = await tasks.findById(scope, notification.entityId);
			return {
				...notification,
				actionState: notification.actionState ?? null,
				actionAt: notification.actionAt ?? null,
				snoozedUntil: notification.snoozedUntil ?? null,
				taskCompleted: task?.completed ?? false,
				taskAssigneeId: task?.assigneeId ?? null,
				taskAvailable: task !== null,
			};
		},
		async countUnread(candidateUserId: string) {
			return assignmentNotifications.filter(
				(item) =>
					item.userId === candidateUserId &&
					item.readAt === null &&
					(item.actionState ?? null) === null,
			).length;
		},
		async resolveTaskNotifications(
			taskId: string,
			state: "completed" | "dismissed",
			actionAt: string,
		) {
			for (const item of assignmentNotifications) {
				if (item.entityId !== taskId) continue;
				item.actionState = state;
				item.actionAt = actionAt;
				item.readAt = actionAt;
			}
		},
		async dismissScheduledForTasks(taskIds: string[]) {
			dismissedScheduledTaskIds.push(...taskIds);
		},
		async getPreferences() {
			return {
				overdueTasksEnabled: true,
				taskAssignmentsEnabled: true,
				timezone: "UTC",
				timezoneConfigured: false,
			};
		},
		async createTaskAssigned(
			candidate: TaskAssignmentCandidate,
			createdAt: string,
		) {
			const notification: Notification = {
				id: crypto.randomUUID(),
				userId: candidate.userId,
				workspaceId: candidate.workspaceId,
				kind: "task.assigned",
				entityId: candidate.taskId,
				entityVersion: candidate.entityVersion,
				payload: {
					taskId: candidate.taskId,
					title: candidate.title,
					assignedByUserId: candidate.assignedByUserId,
					assignedByName: candidate.assignedByName,
					pageId: candidate.pageId,
					sourceBlockId: candidate.sourceBlockId,
				},
				readAt: null,
				createdAt,
			};
			assignmentNotifications.push(notification);
			return notification;
		},
	} as unknown as NotificationRepository;
	const notifications = {
		async send(_definition: unknown, payload: unknown) {
			if (options.assignmentDeliveryFails) {
				throw new Error("Push provider unavailable");
			}
			pushDeliveries.push(payload);
			return {
				notificationName: "tasks.assigned",
				payload,
				channels: ["push"],
				results: [],
			};
		},
	} as unknown as AppContext["ports"]["notifications"];
	// Workspace roster for assignee validation.
	const memberIds = new Set([userId, "user_teammate"]);
	const members = {
		async findRole(organizationId: string, candidateId: string) {
			return organizationId === workspace.id && memberIds.has(candidateId)
				? "member"
				: null;
		},
		async listForUser() {
			return [];
		},
		async listByWorkspace() {
			return [
				{
					userId,
					name: "Test User",
					email: `${userId}@example.com`,
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
	const taskIntegration = createTaskIntegrationPorts({
		documents: pages,
		members,
		notificationInbox,
		tasks,
	});
	const taskAssignmentDelivery = createTaskAssignmentDeliveryPort({
		afterResponse,
		logger: { warn() {} } as unknown as AppContext["ports"]["logger"],
		notifications,
	});
	const fixture = createTestPorts<AppContext["ports"], AppTransactionPorts>({
		base: appPorts,
		overrides: {
			afterResponse,
			gate: appPorts.gate,
			members,
			notificationInbox,
			notifications,
			pageLinks,
			pages,
			pageVersions,
			...taskIntegration,
			taskAssignmentDelivery,
			tasks,
			workspaceEvents,
			devtools: createInMemoryDevtools(),
		},
		transaction: {
			ports: (ports) => ({
				...ports,
				members,
				pages,
				pageVersions,
				...taskIntegration,
				tasks,
			}),
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

	return {
		afterResponseTasks,
		assignmentNotifications,
		dismissedScheduledTaskIds,
		notificationInbox,
		page,
		pages,
		pushDeliveries,
		scope,
		tasks,
		tester,
		workspace,
		ctx,
	};
}

describe("task reconciliation on page content save", () => {
	it("notifies a teammate assigned in a newly imported page", async () => {
		const { assignmentNotifications, tester, workspace, ctx } =
			await createFixture();

		await tester.run(
			createPageUseCase,
			{
				workspaceId: workspace.id,
				title: "Imported plan",
				initialContent: [
					taskBlock("assigned-on-import", "Review the imported plan", {
						assignee: "user_teammate",
					}),
				],
			},
			{ ctx },
		);

		expect(assignmentNotifications).toHaveLength(1);
		expect(assignmentNotifications[0]).toMatchObject({
			userId: "user_teammate",
			kind: "task.assigned",
			payload: {
				title: "Review the imported plan",
				assignedByName: "Test User",
			},
		});
	});

	it("creates task rows for new task blocks", async () => {
		const { tasks, scope, page, tester, ctx } = await createFixture();

		await tester.run(
			savePageContentUseCase,
			{
				id: page.id,
				content: [
					taskBlock("b1", "Ship the tasks feature", {
						due: "2026-07-03",
						dueTime: "14:00",
					}),
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
		expect(shipped?.dueTime).toBe("14:00");
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
						taskBlock("bad-time", "Bad time", {
							due: "2026-07-03",
							dueTime: "2pm",
						}),
					],
				},
				{ ctx },
			),
		).rejects.toThrow("Task due times must be HH:mm");

		await expect(
			tester.run(
				savePageContentUseCase,
				{
					id: page.id,
					content: [
						taskBlock("bad-reminder", "Bad reminder", {
							reminder: "60",
						}),
					],
				},
				{ ctx },
			),
		).rejects.toThrow("Task reminders must use a supported offset");

		await expect(
			tester.run(
				savePageContentUseCase,
				{
					id: page.id,
					content: [
						taskBlock("unsupported-reminder", "Bad reminder", {
							due: "2026-07-03",
							reminder: "30",
						}),
					],
				},
				{ ctx },
			),
		).rejects.toThrow("Task reminders must use a supported offset");

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
	it("resolves tomorrow morning in the saved notification timezone", () => {
		expect(
			resolveSnoozedUntil(
				"tomorrow_9am",
				new Date("2026-03-07T18:00:00.000Z"),
				"America/Chicago",
			).toISOString(),
		).toBe("2026-03-08T14:00:00.000Z");
	});

	it("completes an assigned task from its notification", async () => {
		const {
			assignmentNotifications,
			notificationInbox,
			scope,
			tasks,
			tester,
			ctx,
			workspace,
		} = await createFixture();
		const task = await tester.run(
			createTaskUseCase,
			{
				workspaceId: workspace.id,
				title: "Review the release",
				assigneeId: "user_test",
			},
			{ ctx },
		);
		await notificationInbox.createTaskAssigned(
			{
				taskId: task.id,
				userId: "user_test",
				workspaceId: workspace.id,
				entityVersion: "assignment_test",
				title: task.title,
				assignedByUserId: "user_teammate",
				assignedByName: "Team Mate",
				pageId: null,
				sourceBlockId: null,
			},
			"2026-07-28T12:00:00.000Z",
		);
		const notification = assignmentNotifications.at(-1);
		if (!notification) throw new Error("Expected an assignment notification");

		const result = await tester.run(
			actOnTaskNotificationUseCase,
			{ id: notification.id, action: "complete" },
			{ ctx },
		);

		expect(result).toMatchObject({
			action: "complete",
			notificationId: notification.id,
			taskId: task.id,
			unreadCount: 0,
		});
		expect((await tasks.findById(scope, task.id))?.completed).toBe(true);
		expect(notification.actionState).toBe("completed");
	});

	it("merges notification completion with a concurrent page edit", async () => {
		const {
			assignmentNotifications,
			notificationInbox,
			page,
			pages,
			scope,
			tasks,
			tester,
			ctx,
		} = await createFixture();
		await tester.run(
			savePageContentUseCase,
			{
				id: page.id,
				content: [
					taskBlock("page-task", "Review the shared page", {
						assignee: "user_test",
					}),
				],
			},
			{ ctx },
		);
		const [task] = await tasks.listByPage(scope, page.id);
		if (!task) throw new Error("Expected a page-backed task");
		await notificationInbox.createTaskAssigned(
			{
				taskId: task.id,
				userId: "user_test",
				workspaceId: task.workspaceId,
				entityVersion: "assignment_page_task",
				title: task.title,
				assignedByUserId: "user_teammate",
				assignedByName: "Team Mate",
				pageId: page.id,
				sourceBlockId: "page-task",
			},
			"2026-07-28T12:00:00.000Z",
		);
		const notification = assignmentNotifications.at(-1);
		if (!notification) throw new Error("Expected an assignment notification");

		const concurrentParagraph: BlockJson = {
			id: "concurrent-note",
			type: "paragraph",
			props: {},
			content: [
				{
					type: "text",
					text: "A concurrent edit that must be preserved",
					styles: {},
				},
			],
			children: [],
		};
		const originalSaveContentIf = pages.saveContentIf.bind(pages);
		let injectedConflict = false;
		pages.saveContentIf = async (...args) => {
			if (!injectedConflict) {
				injectedConflict = true;
				const current = await pages.findById(scope, page.id);
				if (!current) throw new Error("Expected the source page");
				const concurrentContent = [...current.content, concurrentParagraph];
				await pages.saveContent(
					scope,
					page.id,
					JSON.stringify(concurrentContent),
					extractPageSearchText(concurrentContent),
				);
				return null;
			}
			return originalSaveContentIf(...args);
		};

		await tester.run(
			actOnTaskNotificationUseCase,
			{ id: notification.id, action: "complete" },
			{ ctx },
		);

		expect((await tasks.findById(scope, task.id))?.completed).toBe(true);
		const savedPage = await pages.findById(scope, page.id);
		expect(savedPage?.content).toEqual([
			expect.objectContaining({
				id: "page-task",
				props: expect.objectContaining({ checked: true }),
			}),
			concurrentParagraph,
		]);
	});

	it("writes My Tasks toggles through to the source page document", async () => {
		const { page, pages, scope, tasks, tester, ctx } = await createFixture();

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
			dueTime: "",
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
					baseUpdatedAt: firstSave.contentUpdatedAt,
				},
				{ ctx },
			),
		).rejects.toThrow(/changed since/);

		const saved = await pages.findById(scope, page.id);
		expect(saved?.content[0]?.props).toEqual({
			checked: true,
			due: "2026-07-04",
			dueTime: "",
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
				dueTime: "14:00",
			},
			{ ctx },
		);
		expect(task.pageId).toBeNull();
		expect(task.dueTime).toBe("14:00");

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

	it("commits an assignment when its best-effort push delivery fails", async () => {
		const {
			afterResponseTasks,
			assignmentNotifications,
			scope,
			tasks,
			tester,
			workspace,
			ctx,
		} = await createFixture("user_test", { assignmentDeliveryFails: true });

		const created = await tester.run(
			createTaskUseCase,
			{
				workspaceId: workspace.id,
				title: "Review the launch plan",
				assigneeId: "user_teammate",
			},
			{ ctx },
		);

		expect(await tasks.findById(scope, created.id)).toMatchObject({
			assigneeId: "user_teammate",
			title: "Review the launch plan",
		});
		expect(assignmentNotifications).toHaveLength(1);
		expect(afterResponseTasks).toHaveLength(2);
		await Promise.all(afterResponseTasks.map((work) => work()));
	});

	it("accepts detailed task titles and rejects only genuinely excessive ones", async () => {
		const { workspace, tester, ctx } = await createFixture();
		const title =
			"Tell Taylor that when I accepted my invite to the Playground workspace, the app said `Invitation not found` in error text, but then redirected me to the new workspace anyway so there is some sort of race condition or state identification bug in the workspace invitations flow on acceptance. Possibly could be I waited too many hours to accept the invite?";

		expect(title.length).toBeGreaterThan(300);
		const created = await tester.run(
			createTaskUseCase,
			{ workspaceId: workspace.id, title },
			{ ctx },
		);
		expect(created.title).toBe(title);

		await expect(
			tester.run(
				createTaskUseCase,
				{
					workspaceId: workspace.id,
					title: "x".repeat(TASK_TITLE_MAX_LENGTH + 1),
				},
				{ ctx },
			),
		).rejects.toThrow(TASK_TITLE_TOO_LONG_MESSAGE);
	});

	it("requires a due date for a time and clears the time with the date", async () => {
		const { workspace, tester, ctx } = await createFixture();
		const task = await tester.run(
			createTaskUseCase,
			{ workspaceId: workspace.id, title: "Pick up meds" },
			{ ctx },
		);

		await expect(
			tester.run(updateTaskUseCase, { id: task.id, dueTime: "14:00" }, { ctx }),
		).rejects.toThrow("A due time requires a due date");

		const scheduled = await tester.run(
			updateTaskUseCase,
			{ id: task.id, dueDate: "2026-07-14", dueTime: "14:00" },
			{ ctx },
		);
		const cleared = await tester.run(
			updateTaskUseCase,
			{ id: task.id, dueDate: null },
			{ ctx },
		);

		expect(scheduled.dueTime).toBe("14:00");
		expect(cleared).toMatchObject({ dueDate: null, dueTime: null });
	});

	it("validates, preserves, and clears proactive reminders with the due date", async () => {
		const { workspace, tester, ctx } = await createFixture();

		await expect(
			tester.run(
				createTaskUseCase,
				{
					workspaceId: workspace.id,
					title: "Prepare update",
					reminderOffsetMinutes: 15,
				},
				{ ctx },
			),
		).rejects.toThrow("A due date is required when a reminder is set");

		const task = await tester.run(
			createTaskUseCase,
			{
				workspaceId: workspace.id,
				title: "Prepare update",
				dueDate: "2026-07-14",
				reminderOffsetMinutes: 60,
			},
			{ ctx },
		);
		expect(task.reminderOffsetMinutes).toBe(60);

		const timed = await tester.run(
			updateTaskUseCase,
			{ id: task.id, dueTime: "14:00" },
			{ ctx },
		);
		expect(timed.reminderOffsetMinutes).toBe(60);

		const cleared = await tester.run(
			updateTaskUseCase,
			{ id: task.id, dueDate: null },
			{ ctx },
		);
		expect(cleared).toMatchObject({
			dueDate: null,
			dueTime: null,
			reminderOffsetMinutes: null,
		});
	});

	it("versions reminders only when scheduling inputs change", async () => {
		const { dismissedScheduledTaskIds, workspace, tasks, tester, ctx } =
			await createFixture();
		const updates: UpdateTaskData[] = [];
		const update = tasks.update.bind(tasks);
		tasks.update = async (scope, id, input) => {
			updates.push(input);
			return update(scope, id, input);
		};
		const task = await tester.run(
			createTaskUseCase,
			{
				workspaceId: workspace.id,
				title: "Prepare update",
				dueDate: "2026-07-14",
				reminderOffsetMinutes: 15,
			},
			{ ctx },
		);

		await tester.run(
			updateTaskUseCase,
			{ id: task.id, title: "Prepare launch update" },
			{ ctx },
		);
		await tester.run(
			updateTaskUseCase,
			{ id: task.id, completed: true },
			{ ctx },
		);
		await tester.run(
			updateTaskUseCase,
			{ id: task.id, dueTime: "14:00" },
			{ ctx },
		);
		await tester.run(
			updateTaskUseCase,
			{
				id: task.id,
				dueDate: "2026-07-14",
				dueTime: "14:00",
				reminderOffsetMinutes: 15,
			},
			{ ctx },
		);

		expect(updates[0]?.reminderConfiguredAt).toBeUndefined();
		expect(updates[1]?.reminderConfiguredAt).toBeUndefined();
		expect(typeof updates[2]?.reminderConfiguredAt).toBe("string");
		expect(updates[3]?.reminderConfiguredAt).toBeUndefined();
		expect(dismissedScheduledTaskIds).toEqual([task.id]);
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
		const { assignmentNotifications, workspace, tester, ctx } =
			await createFixture();

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
		expect(assignmentNotifications).toHaveLength(1);
		expect(assignmentNotifications[0]).toMatchObject({
			userId: "user_teammate",
			kind: "task.assigned",
			payload: {
				title: "For teammate",
				assignedByUserId: "user_test",
				assignedByName: "Test User",
			},
		});
	});

	it("assigns new auto-assignee page task blocks to the saver", async () => {
		const { assignmentNotifications, tasks, scope, page, tester, ctx } =
			await createFixture();

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
		expect(assignmentNotifications).toHaveLength(0);
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
		const { assignmentNotifications, pages, tasks, scope, page, tester, ctx } =
			await createFixture();

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
		expect(assignmentNotifications).toHaveLength(1);

		await tester.run(
			updateTaskUseCase,
			{ id: row.id, assigneeId: "user_teammate" },
			{ ctx },
		);
		expect(assignmentNotifications).toHaveLength(1);
	});

	it("reconciles the assignee from block props on save", async () => {
		const { assignmentNotifications, tasks, scope, page, tester, ctx } =
			await createFixture();

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
		expect(assignmentNotifications).toHaveLength(1);
	});

	it("does not notify when a completed task is assigned", async () => {
		const { assignmentNotifications, workspace, tester, ctx } =
			await createFixture();
		const task = await tester.run(
			createTaskUseCase,
			{ workspaceId: workspace.id, title: "Already done", assigneeId: null },
			{ ctx },
		);
		await tester.run(
			updateTaskUseCase,
			{ id: task.id, completed: true },
			{ ctx },
		);
		await tester.run(
			updateTaskUseCase,
			{ id: task.id, assigneeId: "user_teammate" },
			{ ctx },
		);
		expect(assignmentNotifications).toHaveLength(0);
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

		const dueRange = await tester.run(
			listTasksUseCase,
			{
				workspaceId: workspace.id,
				filter: "open",
				scope: "mine",
				dueOnOrAfter: "2026-07-09",
				dueOnOrBefore: "2026-07-10",
			},
			{ ctx },
		);
		expect(dueRange.items.map((item) => item.title)).toEqual([
			"Due today",
			"Due later",
		]);
	});
});
