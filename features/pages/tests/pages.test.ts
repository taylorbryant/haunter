import { describe, expect, it } from "bun:test";
import { createUseCaseTester } from "@beignet/core/application";
import { createTestTenant, createTestUserActor } from "@beignet/core/ports/testing";
import {
	createTestContextFactory,
	createTestPorts,
} from "@beignet/core/testing";
import { createInMemoryDevtools } from "@beignet/devtools";
import type { AppContext } from "@/app-context";
import { createTestCanvasRepository } from "@/features/canvases/tests/helpers";
import type { PageRepository } from "@/features/pages/ports";
import { createTestTaskRepository } from "@/features/tasks/tests/helpers";
import { appPorts } from "@/infra/app-ports";
import type { AppTransactionPorts } from "@/ports";
import {
	createPageUseCase,
	deletePageUseCase,
	getPageUseCase,
	listBacklinksUseCase,
	listPagesUseCase,
	listTrashUseCase,
	purgePageUseCase,
	restorePageUseCase,
	savePageContentUseCase,
	searchPagesUseCase,
	updatePageUseCase,
} from "../use-cases";
import {
	createTestPageLinkRepository,
	createTestPageRepository,
} from "./helpers";

function createTester(
	userId: string,
	pages: PageRepository,
	workspaceId: string,
	tasks = createTestTaskRepository(),
) {
	const auth = {
		user: {
			id: userId,
			email: `${userId}@example.com`,
			name: "Test User",
		},
		session: { id: `session_${userId}`, activeOrganizationId: workspaceId },
	};
	const canvases = createTestCanvasRepository();
	const pageLinks = createTestPageLinkRepository({ pages });
	const testFixture = createTestPorts<AppContext["ports"], AppTransactionPorts>(
		{
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
				ports: (ports) => ({
					...ports,
					canvases,
					pageLinks,
					pages,
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
		// The active workspace is the request tenant; membership in it is the
		// authorization check.
		tenant: createTestTenant(workspaceId),
	});

	return createUseCaseTester<AppContext>(createTestContext);
}

async function createFixture(userId = "user_test") {
	const pages = createTestPageRepository();
	const tasks = createTestTaskRepository({ pages });
	const workspace = { id: crypto.randomUUID(), name: "Work" };
	const tester = createTester(userId, pages, workspace.id, tasks);
	const ctx = await tester.ctx();

	return { pages, tasks, workspace, tester, ctx };
}

describe("pages use cases", () => {
	it("creates nested pages and lists workspace pages as meta only", async () => {
		const { workspace, tester, ctx } = await createFixture();

		const root = await tester.run(
			createPageUseCase,
			{ workspaceId: workspace.id, title: "Jun 28 – Jul 4" },
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

		expect(child.parentPageId).toBe(root.id);
		expect(listed.items).toHaveLength(2);
		expect(listed.items.every((item) => !("content" in item))).toBe(true);
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
		const foreign = await pages.create({
			userId: "user_test",
			workspaceId: crypto.randomUUID(),
			parentPageId: null,
			title: "B",
			position: 1,
		});

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
		const { pages, tester, ctx, workspace } = await createFixture();

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
		expect(await pages.findMetaById(root.id)).toBeNull();
	});

	it("hides tasks from trashed pages in the workspace task list", async () => {
		const { workspace, tester, ctx, tasks } = await createFixture();

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

		expect(
			await tasks.listByWorkspace("user_test", workspace.id, "all"),
		).toHaveLength(1);

		await tester.run(deletePageUseCase, { id: page.id }, { ctx });
		expect(
			await tasks.listByWorkspace("user_test", workspace.id, "all"),
		).toHaveLength(0);

		await tester.run(restorePageUseCase, { id: page.id }, { ctx });
		expect(
			await tasks.listByWorkspace("user_test", workspace.id, "all"),
		).toHaveLength(1);
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

	it("denies reading a page in another workspace", async () => {
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
		).rejects.toThrow("You do not have access to this page.");
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

		const byTitle = await tester.run(searchPagesUseCase, { q: "MEETING" }, {
			ctx,
		});
		expect(byTitle.items.map((item) => item.id)).toEqual([meeting.id]);
		expect(byTitle.items[0]?.workspaceId).toBe(workspace.id);

		const byBody = await tester.run(searchPagesUseCase, { q: "roadmap" }, {
			ctx,
		});
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
		await pages.create({
			userId: "user_other",
			workspaceId: crypto.randomUUID(),
			parentPageId: null,
			title: "Their meeting agenda",
			position: 1,
		});

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

		const meetings = await tester.run(searchPagesUseCase, { q: "meeting" }, {
			ctx,
		});
		expect(meetings.items).toEqual([]);

		const sql = await tester.run(searchPagesUseCase, { q: "sql" }, { ctx });
		expect(sql.items).toEqual([]);

		const select = await tester.run(searchPagesUseCase, { q: "select" }, {
			ctx,
		});
		expect(select.items.map((item) => item.id)).toEqual([snippets.id]);
	});
});
