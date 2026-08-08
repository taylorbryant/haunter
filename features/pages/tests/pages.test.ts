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
import { createTestCanvasRepository } from "@/features/canvases/tests/helpers";
import type { MemberRepository } from "@/features/members/ports";
import type { NotificationRepository } from "@/features/notifications/ports";
import type {
	PageNavigationRepository,
	PageRepository,
} from "@/features/pages/ports";
import { createTaskIntegrationPorts } from "@/features/tasks/lib/task-integration-ports";
import type { TaskAssignmentDeliveryPort } from "@/features/tasks/ports";
import { createTestTaskRepository } from "@/features/tasks/tests/helpers";
import { appPorts } from "@/infra/app-ports";
import type { AppTransactionPorts } from "@/ports";
import { ACCESS_STATUS_APPROVED } from "@/ports/auth";
import {
	createPageUseCase,
	deletePageUseCase,
	getPageNavigationUseCase,
	getPageUseCase,
	getPageVersionUseCase,
	listBacklinksUseCase,
	listPagesUseCase,
	listPageVersionsUseCase,
	listTrashUseCase,
	purgePageUseCase,
	recordPageViewUseCase,
	restorePageUseCase,
	restorePageVersionUseCase,
	savePageContentUseCase,
	searchPagesUseCase,
	setPageFavoriteUseCase,
	updatePageUseCase,
} from "../use-cases";
import {
	createTestPageLinkRepository,
	createTestPageNavigationRepository,
	createTestPageRepository,
	createTestPageVersionRepository,
	createTestWorkspaceEventPublisher,
} from "./helpers";

function createTester(
	userId: string,
	pages: PageRepository,
	workspaceId: string,
	tasks = createTestTaskRepository(),
	role = "owner",
	workspaceEvents = createTestWorkspaceEventPublisher(),
	pageNavigation = createTestPageNavigationRepository({ pages }),
) {
	const auth = {
		user: {
			id: userId,
			email: `${userId}@example.com`,
			name: "Test User",
			accessStatus: ACCESS_STATUS_APPROVED,
		},
		session: { id: `session_${userId}`, activeOrganizationId: workspaceId },
	};
	const canvases = createTestCanvasRepository();
	const pageLinks = createTestPageLinkRepository({ pages });
	const pageVersions = createTestPageVersionRepository();
	const notificationInbox = {
		async resolveTaskNotifications() {},
		async dismissScheduledForTasks() {},
	} as unknown as NotificationRepository;
	const members = {
		async findRole() {
			return "member";
		},
	} as unknown as MemberRepository;
	const taskIntegration = createTaskIntegrationPorts({
		documents: pages,
		members,
		notificationInbox,
		tasks,
	});
	const taskAssignmentDelivery = {
		schedule() {},
	} satisfies TaskAssignmentDeliveryPort;
	const testFixture = createTestPorts<AppContext["ports"], AppTransactionPorts>(
		{
			base: appPorts,
			overrides: {
				afterResponse: {
					schedule(work) {
						void work();
					},
				},
				gate: appPorts.gate,
				canvases,
				members,
				notificationInbox,
				pageLinks,
				pageNavigation,
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
					canvases,
					members,
					notificationInbox,
					pageLinks,
					pageNavigation,
					pages,
					pageVersions,
					...taskIntegration,
					tasks,
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
		// The active workspace is the request tenant; membership in it — and the
		// member's role — is the authorization check.
		tenant: createTestTenant(workspaceId),
		extra: { membership: { role } },
	});

	return createUseCaseTester<AppContext>(createTestContext);
}

async function createFixture(userId = "user_test") {
	const pages = createTestPageRepository();
	const tasks = createTestTaskRepository({ pages });
	const publishedWorkspaceEvents: import("@/features/collab/workspace-events").WorkspaceEvent[] =
		[];
	const workspaceEvents = createTestWorkspaceEventPublisher(
		publishedWorkspaceEvents,
	);
	const pageNavigation = createTestPageNavigationRepository({ pages });
	// Better Auth org ids are nanoid-style, not UUIDs — use a matching shape so
	// schema validation is exercised realistically.
	const workspace = {
		id: crypto.randomUUID().replaceAll("-", ""),
		name: "Work",
	};
	const tester = createTester(
		userId,
		pages,
		workspace.id,
		tasks,
		"owner",
		workspaceEvents,
		pageNavigation,
	);
	const ctx = await tester.ctx();
	const scope = createTenantScope(createTestTenant(workspace.id));

	return {
		pages,
		tasks,
		workspace,
		scope,
		tester,
		ctx,
		publishedWorkspaceEvents,
		pageNavigation,
	};
}

describe("pages use cases", () => {
	it("creates nested pages and lists workspace pages as meta only", async () => {
		const { workspace, tester, ctx, publishedWorkspaceEvents } =
			await createFixture();

		const root = await tester.run(
			createPageUseCase,
			{ workspaceId: workspace.id, title: "Jun 28 – Jul 4" },
			{ ctx },
		);
		expect(root.parentContentUpdatedAt).toBeNull();
		const intro = {
			id: "intro",
			type: "paragraph",
			props: {},
			content: [{ type: "text", text: "Weekly notes", styles: {} }],
			children: [],
		};
		await tester.run(
			savePageContentUseCase,
			{ id: root.id, content: [intro] },
			{ ctx },
		);
		const child = await tester.run(
			createPageUseCase,
			{
				workspaceId: workspace.id,
				parentPageId: root.id,
				title: "7/2 - Meeting with Josh",
			},
			{ ctx },
		);
		const listed = await tester.run(
			listPagesUseCase,
			{ workspaceId: workspace.id },
			{ ctx },
		);
		const parent = await tester.run(getPageUseCase, { id: root.id }, { ctx });
		const backlinks = await tester.run(
			listBacklinksUseCase,
			{ id: child.id },
			{ ctx },
		);

		expect(child.parentPageId).toBe(root.id);
		expect(child.parentContentUpdatedAt).toBe(parent.updatedAt);
		if (!child.parentContentUpdatedAt) {
			throw new Error("Expected the parent content version");
		}
		expect(parent.content).toHaveLength(2);
		expect(parent.content[0]).toEqual(intro);
		expect(parent.content[1]).toMatchObject({
			id: child.id,
			type: "pageLink",
			props: { pageId: child.id, workspaceId: workspace.id },
		});
		expect(backlinks.items.map((page) => page.id)).toEqual([root.id]);
		expect(publishedWorkspaceEvents.at(-1)).toMatchObject({
			type: "page.created",
			workspaceId: workspace.id,
			pageId: child.id,
			affectedPageIds: [child.id, root.id],
		});
		expect(listed.items).toHaveLength(2);
		expect(listed.items.every((item) => !("content" in item))).toBe(true);
	});

	it("lets the editor place a new subpage block at the cursor", async () => {
		const { workspace, tester, ctx } = await createFixture();
		const parent = await tester.run(
			createPageUseCase,
			{ workspaceId: workspace.id, title: "Parent" },
			{ ctx },
		);
		const child = await tester.run(
			createPageUseCase,
			{
				workspaceId: workspace.id,
				parentPageId: parent.id,
				title: "Child",
				appendToParentContent: false,
			},
			{ ctx },
		);
		const fetched = await tester.run(
			getPageUseCase,
			{ id: parent.id },
			{ ctx },
		);
		const backlinks = await tester.run(
			listBacklinksUseCase,
			{ id: child.id },
			{ ctx },
		);

		expect(fetched.content).toEqual([]);
		expect(backlinks.items).toEqual([]);
		expect(child.parentContentUpdatedAt).toBeNull();
	});

	it("creates imported content atomically and reconciles its task rows", async () => {
		const { workspace, tester, ctx, tasks, scope } = await createFixture();
		const initialContent = [
			{
				id: "imported-heading",
				type: "heading",
				props: { level: 1 },
				content: [{ type: "text", text: "Imported notes", styles: {} }],
				children: [],
			},
			{
				id: "imported-task",
				type: "task",
				props: {
					checked: false,
					due: "2026-07-20",
					dueTime: "09:30",
					assignee: "",
				},
				content: [{ type: "text", text: "Review import", styles: {} }],
				children: [],
			},
		];

		const created = await tester.run(
			createPageUseCase,
			{
				workspaceId: workspace.id,
				title: "Imported notes",
				initialContent,
			},
			{ ctx },
		);
		const fetched = await tester.run(
			getPageUseCase,
			{ id: created.id },
			{ ctx },
		);
		const importedTasks = await tasks.listByPage(scope, created.id);
		const search = await tester.run(
			searchPagesUseCase,
			{ q: "Review import" },
			{ ctx },
		);

		expect(fetched.content).toEqual(initialContent);
		expect(created.contentUpdatedAt).toBe(fetched.contentUpdatedAt);
		expect(importedTasks).toHaveLength(1);
		expect(importedTasks[0]).toMatchObject({
			sourceBlockId: "imported-task",
			title: "Review import",
			dueDate: "2026-07-20",
			dueTime: "09:30",
			assigneeId: null,
		});
		expect(search.items.map((page) => page.id)).toContain(created.id);
	});

	it("preserves a concurrent parent edit while appending a subpage", async () => {
		const { pages, workspace, tester, ctx } = await createFixture();
		const parent = await tester.run(
			createPageUseCase,
			{ workspaceId: workspace.id, title: "Parent" },
			{ ctx },
		);
		const originalSaveContentIf = pages.saveContentIf.bind(pages);
		let attempts = 0;
		pages.saveContentIf = async (...args) => {
			attempts += 1;
			if (attempts === 1) {
				const [scope, pageId] = args;
				const current = await pages.findById(scope, pageId);
				if (!current) throw new Error("Expected parent page");
				const concurrentContent = [
					...current.content,
					{
						id: "concurrent-edit",
						type: "paragraph",
						props: {},
						content: [{ type: "text", text: "Concurrent edit", styles: {} }],
						children: [],
					},
				];
				await pages.saveContent(
					scope,
					pageId,
					JSON.stringify(concurrentContent),
					"Concurrent edit",
				);
				return null;
			}
			return originalSaveContentIf(...args);
		};

		const child = await tester.run(
			createPageUseCase,
			{
				workspaceId: workspace.id,
				parentPageId: parent.id,
				title: "Child",
			},
			{ ctx },
		);
		const fetched = await tester.run(
			getPageUseCase,
			{ id: parent.id },
			{ ctx },
		);

		expect(attempts).toBe(2);
		expect(fetched.content.map((block) => block.type)).toEqual([
			"paragraph",
			"pageLink",
		]);
		expect(fetched.content[1]?.props.pageId).toBe(child.id);
	});

	it("keeps a committed nested page when its live-update signal fails", async () => {
		const pages = createTestPageRepository();
		const workspaceId = crypto.randomUUID().replaceAll("-", "");
		const tester = createTester(
			"user_test",
			pages,
			workspaceId,
			createTestTaskRepository({ pages }),
			"owner",
			{
				async publish() {
					throw new Error("Liveblocks unavailable");
				},
			},
		);
		const ctx = await tester.ctx();
		const parent = await tester.run(
			createPageUseCase,
			{ workspaceId, title: "Parent" },
			{ ctx },
		);

		const child = await tester.run(
			createPageUseCase,
			{ workspaceId, parentPageId: parent.id, title: "Child" },
			{ ctx },
		);
		const fetched = await tester.run(
			getPageUseCase,
			{ id: parent.id },
			{ ctx },
		);

		expect(child.parentPageId).toBe(parent.id);
		expect(fetched.content.at(-1)?.props.pageId).toBe(child.id);
	});

	it("round-trips page content and bumps updatedAt", async () => {
		const { workspace, tester, ctx } = await createFixture();

		const page = await tester.run(
			createPageUseCase,
			{ workspaceId: workspace.id, title: "Notes" },
			{ ctx },
		);
		const content = [
			{
				id: "block-1",
				type: "paragraph",
				props: {},
				content: [{ type: "text", text: "hello", styles: {} }],
				children: [],
			},
		];

		const saved = await tester.run(
			savePageContentUseCase,
			{ id: page.id, content },
			{ ctx },
		);
		const fetched = await tester.run(getPageUseCase, { id: page.id }, { ctx });

		expect(saved.updatedAt >= page.updatedAt).toBe(true);
		expect(fetched.content).toEqual(content);
	});

	it("rejects a stale save and accepts one based on the current version", async () => {
		const { workspace, tester, ctx } = await createFixture();

		const page = await tester.run(
			createPageUseCase,
			{ workspaceId: workspace.id, title: "Contested" },
			{ ctx },
		);
		const block = (text: string) => [
			{
				id: "block-1",
				type: "paragraph",
				props: {},
				content: [{ type: "text", text, styles: {} }],
				children: [],
			},
		];

		// Writer A saves on top of the created version.
		const first = await tester.run(
			savePageContentUseCase,
			{
				id: page.id,
				content: block("A"),
				baseUpdatedAt: page.contentUpdatedAt,
			},
			{ ctx },
		);

		// Writer B still holds the created version: their save must not clobber A.
		await expect(
			tester.run(
				savePageContentUseCase,
				{
					id: page.id,
					content: block("B"),
					baseUpdatedAt: page.contentUpdatedAt,
				},
				{ ctx },
			),
		).rejects.toThrow(/changed since/);

		// After rebasing on A's version, B's save lands.
		const rebased = await tester.run(
			savePageContentUseCase,
			{
				id: page.id,
				content: block("B2"),
				baseUpdatedAt: first.contentUpdatedAt,
			},
			{ ctx },
		);
		expect(rebased.updatedAt >= first.updatedAt).toBe(true);

		const fetched = await tester.run(getPageUseCase, { id: page.id }, { ctx });
		expect(fetched.content).toEqual(block("B2"));
	});

	it("does not invalidate the content token when only metadata changes", async () => {
		const { workspace, tester, ctx } = await createFixture();
		const created = await tester.run(
			createPageUseCase,
			{ workspaceId: workspace.id, title: "Before" },
			{ ctx },
		);
		const initial = await tester.run(
			getPageUseCase,
			{ id: created.id },
			{ ctx },
		);
		const content = [
			{
				id: "body-after-title-save",
				type: "paragraph",
				props: {},
				content: [{ type: "text", text: "body after title save", styles: {} }],
				children: [],
			},
		];

		await tester.run(
			updatePageUseCase,
			{ id: created.id, title: "After" },
			{ ctx },
		);
		const saved = await tester.run(
			savePageContentUseCase,
			{
				id: created.id,
				content,
				baseUpdatedAt: initial.contentUpdatedAt,
			},
			{ ctx },
		);
		const fetched = await tester.run(
			getPageUseCase,
			{ id: created.id },
			{ ctx },
		);

		expect(fetched.title).toBe("After");
		expect(fetched.content).toEqual(content);
		expect(fetched.contentUpdatedAt).toBe(saved.contentUpdatedAt);
	});

	it("rejects moving a page under one of its descendants", async () => {
		const { workspace, tester, ctx } = await createFixture();

		const a = await tester.run(
			createPageUseCase,
			{ workspaceId: workspace.id, title: "A" },
			{ ctx },
		);
		const b = await tester.run(
			createPageUseCase,
			{ workspaceId: workspace.id, parentPageId: a.id, title: "B" },
			{ ctx },
		);
		const c = await tester.run(
			createPageUseCase,
			{ workspaceId: workspace.id, parentPageId: b.id, title: "C" },
			{ ctx },
		);

		await expect(
			tester.run(updatePageUseCase, { id: a.id, parentPageId: c.id }, { ctx }),
		).rejects.toThrow(/moved into itself/);
	});

	it("rejects reparenting into another workspace", async () => {
		const { pages, workspace, tester, ctx } = await createFixture();

		const page = await tester.run(
			createPageUseCase,
			{ workspaceId: workspace.id, title: "A" },
			{ ctx },
		);
		// A page in a different workspace, seeded directly (the tenant guard
		// forbids creating it through the use case from this context).
		const foreign = await pages.create(
			createTenantScope(createTestTenant(crypto.randomUUID())),
			{
				userId: "user_test",
				parentPageId: null,
				title: "B",
				position: 1,
			},
		);

		await expect(
			tester.run(
				updatePageUseCase,
				{ id: page.id, parentPageId: foreign.id },
				{ ctx },
			),
		).rejects.toThrow(/not found/i);
	});

	it("soft-deletes a subtree into the trash and restores it", async () => {
		const { workspace, tester, ctx } = await createFixture();

		const root = await tester.run(
			createPageUseCase,
			{ workspaceId: workspace.id, title: "Root" },
			{ ctx },
		);
		const child = await tester.run(
			createPageUseCase,
			{ workspaceId: workspace.id, parentPageId: root.id, title: "Child" },
			{ ctx },
		);

		await tester.run(deletePageUseCase, { id: root.id }, { ctx });

		const listed = await tester.run(
			listPagesUseCase,
			{ workspaceId: workspace.id },
			{ ctx },
		);
		const trash = await tester.run(
			listTrashUseCase,
			{ workspaceId: workspace.id },
			{ ctx },
		);

		// Only the subtree root shows in the trash; editing trashed pages fails.
		expect(listed.items).toEqual([]);
		expect(trash.items.map((item) => item.id)).toEqual([root.id]);
		await expect(
			tester.run(getPageUseCase, { id: child.id }, { ctx }),
		).rejects.toThrow(/not found/i);
		await expect(
			tester.run(savePageContentUseCase, { id: root.id, content: [] }, { ctx }),
		).rejects.toThrow(/not found/i);

		const restored = await tester.run(
			restorePageUseCase,
			{ id: root.id },
			{ ctx },
		);
		const afterRestore = await tester.run(
			listPagesUseCase,
			{ workspaceId: workspace.id },
			{ ctx },
		);

		expect(restored.deletedAt).toBeNull();
		expect(afterRestore.items.map((item) => item.id).sort()).toEqual(
			[root.id, child.id].sort(),
		);
	});

	it("restores a child of a still-trashed parent to the workspace root", async () => {
		const { workspace, tester, ctx } = await createFixture();

		const parent = await tester.run(
			createPageUseCase,
			{ workspaceId: workspace.id, title: "Parent" },
			{ ctx },
		);
		const child = await tester.run(
			createPageUseCase,
			{ workspaceId: workspace.id, parentPageId: parent.id, title: "Child" },
			{ ctx },
		);

		await tester.run(deletePageUseCase, { id: parent.id }, { ctx });
		const restored = await tester.run(
			restorePageUseCase,
			{ id: child.id },
			{ ctx },
		);

		expect(restored.parentPageId).toBeNull();
		expect(restored.deletedAt).toBeNull();
	});

	it("purges a trashed subtree with its tasks", async () => {
		const { pages, scope, tester, ctx, workspace } = await createFixture();

		const root = await tester.run(
			createPageUseCase,
			{ workspaceId: workspace.id, title: "Root" },
			{ ctx },
		);
		await tester.run(
			savePageContentUseCase,
			{
				id: root.id,
				content: [
					{
						id: "task-1",
						type: "task",
						props: { checked: false, due: "" },
						content: [{ type: "text", text: "Doomed", styles: {} }],
						children: [],
					},
				],
			},
			{ ctx },
		);

		await tester.run(deletePageUseCase, { id: root.id }, { ctx });
		await tester.run(purgePageUseCase, { id: root.id }, { ctx });

		const trash = await tester.run(
			listTrashUseCase,
			{ workspaceId: workspace.id },
			{ ctx },
		);
		expect(trash.items).toEqual([]);
		expect(await pages.findMetaById(scope, root.id)).toBeNull();
	});

	it("hides tasks from trashed pages in the workspace task list", async () => {
		const { workspace, scope, tester, ctx, tasks } = await createFixture();

		const page = await tester.run(
			createPageUseCase,
			{ workspaceId: workspace.id, title: "With task" },
			{ ctx },
		);
		await tester.run(
			savePageContentUseCase,
			{
				id: page.id,
				content: [
					{
						id: "task-1",
						type: "task",
						props: { checked: false, due: "" },
						content: [{ type: "text", text: "Hide me", styles: {} }],
						children: [],
					},
				],
			},
			{ ctx },
		);

		expect(await tasks.listByWorkspace(scope, "all")).toHaveLength(1);

		await tester.run(deletePageUseCase, { id: page.id }, { ctx });
		expect(await tasks.listByWorkspace(scope, "all")).toHaveLength(0);

		await tester.run(restorePageUseCase, { id: page.id }, { ctx });
		expect(await tasks.listByWorkspace(scope, "all")).toHaveLength(1);
	});

	it("deletes a page and all of its descendants", async () => {
		const { workspace, tester, ctx } = await createFixture();

		const root = await tester.run(
			createPageUseCase,
			{ workspaceId: workspace.id, title: "Root" },
			{ ctx },
		);
		const child = await tester.run(
			createPageUseCase,
			{ workspaceId: workspace.id, parentPageId: root.id, title: "Child" },
			{ ctx },
		);
		await tester.run(
			createPageUseCase,
			{
				workspaceId: workspace.id,
				parentPageId: child.id,
				title: "Grandchild",
			},
			{ ctx },
		);
		const sibling = await tester.run(
			createPageUseCase,
			{ workspaceId: workspace.id, title: "Sibling" },
			{ ctx },
		);

		await tester.run(deletePageUseCase, { id: root.id }, { ctx });
		const listed = await tester.run(
			listPagesUseCase,
			{ workspaceId: workspace.id },
			{ ctx },
		);

		expect(listed.items.map((item) => item.id)).toEqual([sibling.id]);
	});

	it("treats a page in another workspace as not found", async () => {
		const { pages, workspace, tester, ctx } = await createFixture();

		const page = await tester.run(
			createPageUseCase,
			{ workspaceId: workspace.id, title: "Private" },
			{ ctx },
		);

		// A member of a different workspace (different active tenant) is denied.
		const intruder = createTester("user_intruder", pages, crypto.randomUUID());
		const intruderCtx = await intruder.ctx();

		await expect(
			intruder.run(getPageUseCase, { id: page.id }, { ctx: intruderCtx }),
		).rejects.toThrow("Page not found");
	});

	it("lets a viewer read but not edit or create pages", async () => {
		const pages = createTestPageRepository();
		const workspaceId = crypto.randomUUID().replaceAll("-", "");

		// An editor seeds a page in the workspace.
		const editor = createTester("user_owner", pages, workspaceId);
		const editorCtx = await editor.ctx();
		const page = await editor.run(
			createPageUseCase,
			{ workspaceId, title: "Shared" },
			{ ctx: editorCtx },
		);

		// A viewer in the same workspace can read it but not write.
		const viewer = createTester(
			"user_viewer",
			pages,
			workspaceId,
			createTestTaskRepository({ pages }),
			"viewer",
		);
		const viewerCtx = await viewer.ctx();

		const read = await viewer.run(
			getPageUseCase,
			{ id: page.id },
			{ ctx: viewerCtx },
		);
		expect(read.id).toBe(page.id);

		await expect(
			viewer.run(
				updatePageUseCase,
				{ id: page.id, title: "Nope" },
				{ ctx: viewerCtx },
			),
		).rejects.toThrow("view-only");
		await expect(
			viewer.run(
				createPageUseCase,
				{ workspaceId, title: "Nope" },
				{ ctx: viewerCtx },
			),
		).rejects.toThrow("view-only");
	});

	it("reconciles page links on save and lists backlinks", async () => {
		const { workspace, tester, ctx } = await createFixture();

		const target = await tester.run(
			createPageUseCase,
			{ workspaceId: workspace.id, title: "Target" },
			{ ctx },
		);
		const source = await tester.run(
			createPageUseCase,
			{ workspaceId: workspace.id, title: "Source" },
			{ ctx },
		);

		await tester.run(
			savePageContentUseCase,
			{
				id: source.id,
				content: [
					{
						id: "block_link",
						type: "pageLink",
						props: { pageId: target.id },
						children: [],
					},
					{
						id: "block_mention",
						type: "paragraph",
						props: {},
						content: [
							{ type: "text", text: "See ", styles: {} },
							{ type: "mention", props: { pageId: target.id } },
							// Self-references and dangling ids must be ignored.
							{ type: "mention", props: { pageId: source.id } },
							{ type: "mention", props: { pageId: crypto.randomUUID() } },
						],
						children: [],
					},
				],
			},
			{ ctx },
		);

		const backlinks = await tester.run(
			listBacklinksUseCase,
			{ id: target.id },
			{ ctx },
		);
		expect(backlinks.items.map((item) => item.id)).toEqual([source.id]);

		const selfBacklinks = await tester.run(
			listBacklinksUseCase,
			{ id: source.id },
			{ ctx },
		);
		expect(selfBacklinks.items).toEqual([]);

		// Removing the references removes the backlinks.
		await tester.run(
			savePageContentUseCase,
			{
				id: source.id,
				content: [
					{
						id: "block_plain",
						type: "paragraph",
						props: {},
						content: [{ type: "text", text: "No more links", styles: {} }],
						children: [],
					},
				],
			},
			{ ctx },
		);
		const cleared = await tester.run(
			listBacklinksUseCase,
			{ id: target.id },
			{ ctx },
		);
		expect(cleared.items).toEqual([]);
	});

	it("hides backlinks from trashed source pages", async () => {
		const { workspace, tester, ctx } = await createFixture();

		const target = await tester.run(
			createPageUseCase,
			{ workspaceId: workspace.id, title: "Target" },
			{ ctx },
		);
		const source = await tester.run(
			createPageUseCase,
			{ workspaceId: workspace.id, title: "Source" },
			{ ctx },
		);
		await tester.run(
			savePageContentUseCase,
			{
				id: source.id,
				content: [
					{
						id: "block_link",
						type: "pageLink",
						props: { pageId: target.id },
						children: [],
					},
				],
			},
			{ ctx },
		);

		await tester.run(deletePageUseCase, { id: source.id }, { ctx });

		const backlinks = await tester.run(
			listBacklinksUseCase,
			{ id: target.id },
			{ ctx },
		);
		expect(backlinks.items).toEqual([]);
	});

	it("reports whether content saves changed derived tasks or links", async () => {
		const { workspace, tester, ctx } = await createFixture();

		const target = await tester.run(
			createPageUseCase,
			{ workspaceId: workspace.id, title: "Target" },
			{ ctx },
		);
		const source = await tester.run(
			createPageUseCase,
			{ workspaceId: workspace.id, title: "Source" },
			{ ctx },
		);
		const linkBlock = {
			id: "link",
			type: "pageLink",
			props: { pageId: target.id },
			children: [],
		};
		const taskBlock = {
			id: "task",
			type: "task",
			props: { checked: false },
			content: [{ type: "text", text: "Follow up", styles: {} }],
			children: [],
		};

		const plain = await tester.run(
			savePageContentUseCase,
			{
				id: source.id,
				content: [
					{
						id: "plain",
						type: "paragraph",
						props: {},
						content: [{ type: "text", text: "No derived data", styles: {} }],
						children: [],
					},
				],
			},
			{ ctx },
		);
		expect(plain.tasksChanged).toBe(false);
		expect(plain.linksChanged).toBe(false);

		const linked = await tester.run(
			savePageContentUseCase,
			{ id: source.id, content: [linkBlock] },
			{ ctx },
		);
		expect(linked.tasksChanged).toBe(false);
		expect(linked.linksChanged).toBe(true);

		const unchanged = await tester.run(
			savePageContentUseCase,
			{ id: source.id, content: [linkBlock] },
			{ ctx },
		);
		expect(unchanged.tasksChanged).toBe(false);
		expect(unchanged.linksChanged).toBe(false);

		const withTask = await tester.run(
			savePageContentUseCase,
			{ id: source.id, content: [linkBlock, taskBlock] },
			{ ctx },
		);
		expect(withTask.tasksChanged).toBe(true);
		expect(withTask.linksChanged).toBe(false);
	});

	it("searches page titles and body text with snippets", async () => {
		const { workspace, tester, ctx } = await createFixture();

		const meeting = await tester.run(
			createPageUseCase,
			{ workspaceId: workspace.id, title: "Meeting with Josh" },
			{ ctx },
		);
		const notes = await tester.run(
			createPageUseCase,
			{ workspaceId: workspace.id, title: "Notes" },
			{ ctx },
		);
		await tester.run(
			savePageContentUseCase,
			{
				id: notes.id,
				content: [
					{
						id: "block_1",
						type: "paragraph",
						props: {},
						content: [
							{
								type: "text",
								text: "Discussed the quarterly roadmap in depth",
								styles: {},
							},
						],
						children: [],
					},
				],
			},
			{ ctx },
		);

		const byTitle = await tester.run(
			searchPagesUseCase,
			{ q: "MEETING" },
			{
				ctx,
			},
		);
		expect(byTitle.items.map((item) => item.id)).toEqual([meeting.id]);
		expect(byTitle.items[0]?.workspaceId).toBe(workspace.id);

		const byBody = await tester.run(
			searchPagesUseCase,
			{ q: "roadmap" },
			{
				ctx,
			},
		);
		expect(byBody.items.map((item) => item.id)).toEqual([notes.id]);
		expect(byBody.items[0]?.snippet).toContain("roadmap");
	});

	it("search skips trashed pages, other workspaces' pages, and prop-only JSON matches", async () => {
		const { pages, workspace, tester, ctx } = await createFixture();

		const trashed = await tester.run(
			createPageUseCase,
			{ workspaceId: workspace.id, title: "Old meeting notes" },
			{ ctx },
		);
		await tester.run(deletePageUseCase, { id: trashed.id }, { ctx });

		// A page in a different workspace must not surface in this workspace's
		// search, even though its title matches.
		await pages.create(
			createTenantScope(createTestTenant(crypto.randomUUID())),
			{
				userId: "user_other",
				parentPageId: null,
				title: "Their meeting agenda",
				position: 1,
			},
		);

		// "sql" appears only in the code block's language prop, not its text.
		const snippets = await tester.run(
			createPageUseCase,
			{ workspaceId: workspace.id, title: "Snippets" },
			{ ctx },
		);
		await tester.run(
			savePageContentUseCase,
			{
				id: snippets.id,
				content: [
					{
						id: "block_code",
						type: "codeBlock",
						props: { language: "sql" },
						content: [{ type: "text", text: "select 1", styles: {} }],
						children: [],
					},
				],
			},
			{ ctx },
		);

		const meetings = await tester.run(
			searchPagesUseCase,
			{ q: "meeting" },
			{
				ctx,
			},
		);
		expect(meetings.items).toEqual([]);

		const sql = await tester.run(searchPagesUseCase, { q: "sql" }, { ctx });
		expect(sql.items).toEqual([]);

		const select = await tester.run(
			searchPagesUseCase,
			{ q: "select" },
			{
				ctx,
			},
		);
		expect(select.items.map((item) => item.id)).toEqual([snippets.id]);
	});
});

describe("page versioning", () => {
	const block = (id: string, text: string) => ({
		id,
		type: "paragraph",
		props: {},
		content: [{ type: "text", text, styles: {} }],
		children: [],
	});
	const taskBlock = (id: string, text: string) => ({
		id,
		type: "task",
		props: { checked: false, due: "", assignee: "" },
		content: [{ type: "text", text, styles: {} }],
		children: [],
	});

	it("checkpoints the pre-save state once per interval", async () => {
		const { workspace, tester, ctx } = await createFixture();
		const page = await tester.run(
			createPageUseCase,
			{ workspaceId: workspace.id, title: "Versioned" },
			{ ctx },
		);

		// First save: page is empty, nothing to checkpoint.
		await tester.run(
			savePageContentUseCase,
			{ id: page.id, content: [block("b1", "v1")] },
			{ ctx },
		);
		let versions = await tester.run(
			listPageVersionsUseCase,
			{ id: page.id },
			{ ctx },
		);
		expect(versions.items).toHaveLength(0);

		// Second save checkpoints the pre-save ("v1") state...
		await tester.run(
			savePageContentUseCase,
			{ id: page.id, content: [block("b1", "v2")] },
			{ ctx },
		);
		versions = await tester.run(
			listPageVersionsUseCase,
			{ id: page.id },
			{ ctx },
		);
		expect(versions.items).toHaveLength(1);
		expect(versions.items[0]?.cause).toBe("checkpoint");

		// ...and further saves inside the interval don't add more.
		await tester.run(
			savePageContentUseCase,
			{ id: page.id, content: [block("b1", "v3")] },
			{ ctx },
		);
		versions = await tester.run(
			listPageVersionsUseCase,
			{ id: page.id },
			{ ctx },
		);
		expect(versions.items).toHaveLength(1);

		const stored = await tester.run(
			getPageVersionUseCase,
			{ id: page.id, versionId: versions.items[0]?.id ?? "" },
			{ ctx },
		);
		expect(stored.content).toEqual([block("b1", "v1")]);
	});

	it("restore snapshots the current state, applies the version, and reconciles tasks", async () => {
		const { tasks, workspace, scope, tester, ctx } = await createFixture();
		const page = await tester.run(
			createPageUseCase,
			{ workspaceId: workspace.id, title: "Restorable" },
			{ ctx },
		);

		// v1 has a task block; the current doc replaced it with a paragraph.
		await tester.run(
			savePageContentUseCase,
			{ id: page.id, content: [taskBlock("t1", "Old task")] },
			{ ctx },
		);
		await tester.run(
			savePageContentUseCase,
			{ id: page.id, content: [block("b2", "No more tasks")] },
			{ ctx },
		);
		expect(await tasks.listByPage(scope, page.id)).toHaveLength(0);

		const versions = await tester.run(
			listPageVersionsUseCase,
			{ id: page.id },
			{ ctx },
		);
		const withTask = versions.items.at(-1);
		if (!withTask) throw new Error("Expected a checkpoint.");

		await tester.run(
			restorePageVersionUseCase,
			{ id: page.id, versionId: withTask.id },
			{ ctx },
		);

		// The doc is back on v1 and its task row is reconciled back into being.
		const restored = await tester.run(getPageUseCase, { id: page.id }, { ctx });
		expect(restored.content).toEqual([taskBlock("t1", "Old task")]);
		expect(await tasks.listByPage(scope, page.id)).toHaveLength(1);

		// The pre-restore state was preserved as a "restore" version.
		const after = await tester.run(
			listPageVersionsUseCase,
			{ id: page.id },
			{ ctx },
		);
		expect(after.items.some((item) => item.cause === "restore")).toBe(true);
	});

	it("viewers can read history but not restore", async () => {
		const { pages, workspace, tester, ctx } = await createFixture();
		const page = await tester.run(
			createPageUseCase,
			{ workspaceId: workspace.id, title: "Guarded" },
			{ ctx },
		);
		await tester.run(
			savePageContentUseCase,
			{ id: page.id, content: [block("b1", "v1")] },
			{ ctx },
		);
		await tester.run(
			savePageContentUseCase,
			{ id: page.id, content: [block("b1", "v2")] },
			{ ctx },
		);

		const viewer = createTester(
			"user_viewer",
			pages,
			workspace.id,
			createTestTaskRepository({ pages }),
			"viewer",
		);
		const viewerCtx = await viewer.ctx();

		// Reading history is fine... (fresh fixture repos per tester means the
		// viewer's version repo is empty, so just assert no denial)
		await viewer.run(
			listPageVersionsUseCase,
			{ id: page.id },
			{
				ctx: viewerCtx,
			},
		);

		const versions = await tester.run(
			listPageVersionsUseCase,
			{ id: page.id },
			{ ctx },
		);
		await expect(
			viewer.run(
				restorePageVersionUseCase,
				{ id: page.id, versionId: versions.items[0]?.id ?? "" },
				{ ctx: viewerCtx },
			),
		).rejects.toThrow("view-only");
	});

	it("keeps favorites personal, newest-first, and available to viewers", async () => {
		const { pages, pageNavigation, workspace, tester, ctx } =
			await createFixture();
		const first = await tester.run(
			createPageUseCase,
			{ workspaceId: workspace.id, title: "First" },
			{ ctx },
		);
		const second = await tester.run(
			createPageUseCase,
			{ workspaceId: workspace.id, title: "Second" },
			{ ctx },
		);

		await tester.run(
			setPageFavoriteUseCase,
			{ id: first.id, favorite: true },
			{ ctx },
		);
		await tester.run(
			setPageFavoriteUseCase,
			{ id: second.id, favorite: true },
			{ ctx },
		);
		expect(
			(
				await tester.run(
					getPageNavigationUseCase,
					{ workspaceId: workspace.id },
					{ ctx },
				)
			).favorites.map((page) => page.title),
		).toEqual(["Second", "First"]);

		const viewer = createTester(
			"user_viewer",
			pages,
			workspace.id,
			createTestTaskRepository({ pages }),
			"viewer",
			createTestWorkspaceEventPublisher(),
			pageNavigation,
		);
		const viewerCtx = await viewer.ctx();
		await viewer.run(
			setPageFavoriteUseCase,
			{ id: first.id, favorite: true },
			{ ctx: viewerCtx },
		);
		expect(
			(
				await viewer.run(
					getPageNavigationUseCase,
					{ workspaceId: workspace.id },
					{ ctx: viewerCtx },
				)
			).favorites.map((page) => page.id),
		).toEqual([first.id]);

		await tester.run(
			setPageFavoriteUseCase,
			{ id: first.id, favorite: false },
			{ ctx },
		);
		expect(
			(
				await tester.run(
					getPageNavigationUseCase,
					{ workspaceId: workspace.id },
					{ ctx },
				)
			).favorites.map((page) => page.id),
		).toEqual([second.id]);
	});

	it("tracks ten recent views and omits trashed pages until restored", async () => {
		const { workspace, tester, ctx } = await createFixture();
		const created = [];
		for (let index = 0; index < 12; index += 1) {
			const page = await tester.run(
				createPageUseCase,
				{ workspaceId: workspace.id, title: `Page ${index}` },
				{ ctx },
			);
			created.push(page);
			await tester.run(recordPageViewUseCase, { id: page.id }, { ctx });
		}

		let navigation = await tester.run(
			getPageNavigationUseCase,
			{ workspaceId: workspace.id },
			{ ctx },
		);
		expect(navigation.recents).toHaveLength(10);
		const latest = created.at(-1);
		if (!latest) throw new Error("Expected a recent page");
		expect(navigation.recents[0]?.id).toBe(latest.id);
		await tester.run(deletePageUseCase, { id: latest.id }, { ctx });
		navigation = await tester.run(
			getPageNavigationUseCase,
			{ workspaceId: workspace.id },
			{ ctx },
		);
		expect(navigation.recents.some((page) => page.id === latest.id)).toBe(
			false,
		);

		await tester.run(restorePageUseCase, { id: latest.id }, { ctx });
		navigation = await tester.run(
			getPageNavigationUseCase,
			{ workspaceId: workspace.id },
			{ ctx },
		);
		expect(navigation.recents[0]?.id).toBe(latest.id);
	});
});
