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
import type { InboxRepository } from "@/features/inbox/ports";
import { createTestInboxRepository } from "@/features/inbox/tests/helpers";
import {
	captureInboxItemUseCase,
	listInboxItemsUseCase,
	resolveInboxItemUseCase,
} from "@/features/inbox/use-cases";
import type { PageRepository } from "@/features/pages/ports";
import { createTestPageRepository } from "@/features/pages/tests/helpers";
import type { TaskRepository } from "@/features/tasks/ports";
import { createTestTaskRepository } from "@/features/tasks/tests/helpers";
import { appPorts } from "@/infra/app-ports";
import type { AppTransactionPorts } from "@/ports";
import { ACCESS_STATUS_APPROVED } from "@/ports/auth";

function createTester(input: {
	userId: string;
	workspaceId: string;
	pages: PageRepository;
	tasks: TaskRepository;
	inboxItems: InboxRepository;
	role?: string;
}) {
	const auth = {
		user: {
			id: input.userId,
			email: `${input.userId}@example.com`,
			name: input.userId,
			accessStatus: ACCESS_STATUS_APPROVED,
		},
		session: {
			id: `session_${input.userId}`,
			activeOrganizationId: input.workspaceId,
		},
	};
	const fixture = createTestPorts<AppContext["ports"], AppTransactionPorts>({
		base: appPorts,
		overrides: {
			devtools: createInMemoryDevtools(),
			gate: appPorts.gate,
			inboxItems: input.inboxItems,
			pages: input.pages,
			tasks: input.tasks,
		},
		transaction: {
			ports: (ports) => ({
				...ports,
				inboxItems: input.inboxItems,
				pages: input.pages,
				tasks: input.tasks,
			}),
		},
	});
	const createTestContext = createTestContextFactory<
		AppContext,
		AppContext["ports"]
	>({
		ports: fixture.ports,
		actor: createTestUserActor(input.userId, {
			displayName: input.userId,
		}),
		auth,
		tenant: createTestTenant(input.workspaceId),
		extra: { membership: { role: input.role ?? "owner" } },
	});
	return createUseCaseTester<AppContext>(createTestContext);
}

async function createFixture() {
	const workspaceId = crypto.randomUUID().replaceAll("-", "");
	const pages = createTestPageRepository();
	const tasks = createTestTaskRepository({ pages });
	const inboxItems = createTestInboxRepository({ pages, tasks });
	const tester = createTester({
		userId: "user_owner",
		workspaceId,
		pages,
		tasks,
		inboxItems,
	});
	const ctx = await tester.ctx();
	const scope = createTenantScope(createTestTenant(workspaceId));
	return {
		ctx,
		inboxItems,
		pages,
		scope,
		tasks,
		tester,
		workspaceId,
	};
}

describe("personal inbox", () => {
	it("captures a note with details and lists it for its owner", async () => {
		const { ctx, pages, tester, workspaceId } = await createFixture();

		const captured = await tester.run(
			captureInboxItemUseCase,
			{
				workspaceId,
				kind: "page",
				title: "Research onboarding",
				details: "Interview new users.\nSummarize the common friction.",
			},
			{ ctx },
		);
		const listed = await tester.run(
			listInboxItemsUseCase,
			{ workspaceId, limit: 20 },
			{ ctx },
		);
		const page = await pages.findById(
			createTenantScope(createTestTenant(workspaceId)),
			captured.page?.id ?? "",
		);

		expect(captured).toMatchObject({
			kind: "page",
			page: { title: "Research onboarding", parentPageId: null },
		});
		expect(listed.items.map((item) => item.id)).toEqual([captured.id]);
		expect(page?.content).toHaveLength(2);
		expect(page?.content[0]).toMatchObject({
			type: "paragraph",
			content: [{ type: "text", text: "Interview new users." }],
		});
	});

	it("captures a task assigned to the current user", async () => {
		const { ctx, tester, workspaceId } = await createFixture();

		const captured = await tester.run(
			captureInboxItemUseCase,
			{
				workspaceId,
				kind: "task",
				title: "Send the agenda",
				dueDate: "2026-07-28",
				dueTime: "09:30",
			},
			{ ctx },
		);

		expect(captured).toMatchObject({
			kind: "task",
			task: {
				title: "Send the agenda",
				assigneeId: "user_owner",
				pageId: null,
				sourceBlockId: null,
				dueDate: "2026-07-28",
				dueTime: "09:30",
			},
		});
	});

	it("keeps each user's inbox private inside a shared workspace", async () => {
		const { inboxItems, pages, tasks, workspaceId } = await createFixture();
		const ownerTester = createTester({
			userId: "user_owner",
			workspaceId,
			pages,
			tasks,
			inboxItems,
		});
		const teammateTester = createTester({
			userId: "user_teammate",
			workspaceId,
			pages,
			tasks,
			inboxItems,
		});
		const ownerCtx = await ownerTester.ctx();
		const teammateCtx = await teammateTester.ctx();

		await ownerTester.run(
			captureInboxItemUseCase,
			{ workspaceId, kind: "page", title: "Private triage state" },
			{ ctx: ownerCtx },
		);

		const ownerItems = await ownerTester.run(
			listInboxItemsUseCase,
			{ workspaceId, limit: 20 },
			{ ctx: ownerCtx },
		);
		const teammateItems = await teammateTester.run(
			listInboxItemsUseCase,
			{ workspaceId, limit: 20 },
			{ ctx: teammateCtx },
		);

		expect(ownerItems.items).toHaveLength(1);
		expect(teammateItems.items).toEqual([]);
	});

	it("paginates the full Inbox backlog without duplicates", async () => {
		const { ctx, tester, workspaceId } = await createFixture();
		const capturedIds: string[] = [];
		for (let index = 0; index < 7; index += 1) {
			const captured = await tester.run(
				captureInboxItemUseCase,
				{
					workspaceId,
					kind: "page",
					title: `Captured note ${index + 1}`,
				},
				{ ctx },
			);
			capturedIds.push(captured.id);
		}

		const first = await tester.run(
			listInboxItemsUseCase,
			{ workspaceId, limit: 3 },
			{ ctx },
		);
		const second = await tester.run(
			listInboxItemsUseCase,
			{
				workspaceId,
				limit: 3,
				...(first.page.nextCursor ? { cursor: first.page.nextCursor } : {}),
			},
			{ ctx },
		);
		const third = await tester.run(
			listInboxItemsUseCase,
			{
				workspaceId,
				limit: 3,
				...(second.page.nextCursor ? { cursor: second.page.nextCursor } : {}),
			},
			{ ctx },
		);

		expect(first.page).toMatchObject({ hasMore: true, limit: 3 });
		expect(second.page).toMatchObject({ hasMore: true, limit: 3 });
		expect(third.page).toMatchObject({
			hasMore: false,
			limit: 3,
			nextCursor: null,
		});
		expect(
			[...first.items, ...second.items, ...third.items].map((item) => item.id),
		).toEqual([...capturedIds].reverse());
	});

	it("files a captured note beneath a valid destination", async () => {
		const { ctx, pages, scope, tester, workspaceId } = await createFixture();
		const destination = await pages.create(scope, {
			userId: "user_owner",
			parentPageId: null,
			title: "Projects",
			position: 1,
		});
		const captured = await tester.run(
			captureInboxItemUseCase,
			{ workspaceId, kind: "page", title: "Launch notes" },
			{ ctx },
		);

		await tester.run(
			resolveInboxItemUseCase,
			{
				id: captured.id,
				action: "file_page",
				parentPageId: destination.id,
			},
			{ ctx },
		);

		const page = await pages.findMetaById(scope, captured.page?.id ?? "");
		const remaining = await tester.run(
			listInboxItemsUseCase,
			{ workspaceId, limit: 20 },
			{ ctx },
		);
		expect(page?.parentPageId).toBe(destination.id);
		expect(remaining.items).toEqual([]);
	});

	it("schedules or completes captured tasks and removes them from Inbox", async () => {
		const { ctx, tasks, scope, tester, workspaceId } = await createFixture();
		const scheduled = await tester.run(
			captureInboxItemUseCase,
			{ workspaceId, kind: "task", title: "Plan tomorrow" },
			{ ctx },
		);
		await tester.run(
			resolveInboxItemUseCase,
			{
				id: scheduled.id,
				action: "schedule_task",
				dueDate: "2026-07-29",
				dueTime: "14:15",
			},
			{ ctx },
		);

		const completed = await tester.run(
			captureInboxItemUseCase,
			{ workspaceId, kind: "task", title: "Tiny follow-up" },
			{ ctx },
		);
		await tester.run(
			resolveInboxItemUseCase,
			{ id: completed.id, action: "complete_task" },
			{ ctx },
		);

		const scheduledTask = await tasks.findById(scope, scheduled.task?.id ?? "");
		const completedTask = await tasks.findById(scope, completed.task?.id ?? "");
		const remaining = await tester.run(
			listInboxItemsUseCase,
			{ workspaceId, limit: 20 },
			{ ctx },
		);
		expect(scheduledTask).toMatchObject({
			dueDate: "2026-07-29",
			dueTime: "14:15",
		});
		expect(completedTask?.completed).toBe(true);
		expect(completedTask?.completedAt).not.toBeNull();
		expect(remaining.items).toEqual([]);
	});

	it("rejects actions that do not match the captured resource", async () => {
		const { ctx, tester, workspaceId } = await createFixture();
		const captured = await tester.run(
			captureInboxItemUseCase,
			{ workspaceId, kind: "task", title: "Keep this task" },
			{ ctx },
		);

		await expect(
			tester.run(
				resolveInboxItemUseCase,
				{
					id: captured.id,
					action: "file_page",
					parentPageId: null,
				},
				{ ctx },
			),
		).rejects.toMatchObject({ code: "INVALID_INBOX_ACTION" });

		const listed = await tester.run(
			listInboxItemsUseCase,
			{ workspaceId, limit: 20 },
			{ ctx },
		);
		expect(listed.items.map((item) => item.id)).toEqual([captured.id]);
	});
});
