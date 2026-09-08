import { seedFixtureBody } from "./helpers";
import { expect, test } from "bun:test";
import { HocuspocusProvider } from "@hocuspocus/provider";
import * as Y from "yjs";
import { createTenantScope } from "@beignet/core/ports";
import { appendToPageCapability } from "@/features/pages/agent-capabilities";
import {
	appendPageContentUseCase,
	createPageUseCase,
} from "@/features/pages/use-cases";
import { updateTaskUseCase } from "@/features/tasks/use-cases/update-task";
import { actOnTaskNotificationUseCase } from "@/features/tasks/use-cases/act-on-task-notification";
import { loadPageBody, persistPageBody } from "@/infra/documents/persistence";
import { projectPageBody } from "@/infra/documents/codec";
import { createDocumentServer } from "@/infra/documents/hocuspocus";
import {
	listenDocumentServer,
	stopDocumentServer,
} from "@/infra/documents/bun-transport";
import { createDocumentSessionTokens } from "@/infra/documents/session-token";
import { checkDocumentAccess } from "@/infra/documents/access";
import { pageDocumentName } from "../model";
import { receiptCoversDocument } from "../receipt";
import { documentFixture, firstText } from "./helpers";

const paragraph = (text: string) => ({
	id: crypto.randomUUID(),
	type: "paragraph",
	props: {},
	content: [{ type: "text", text, styles: {} }],
	children: [],
});

async function fixture() {
	const f = await documentFixture();
	await seedFixtureBody(
		f,
		[
			paragraph("Original text"),
			{
				id: "nested",
				type: "callout",
				props: {},
				content: [],
				children: [
					{
						id: "task-block",
						type: "task",
						props: { checked: false, assignee: f.userId },
						content: [{ type: "text", text: "Nested task", styles: {} }],
						children: [],
					},
				],
			},
		],
		true,
	);
	const stored = await loadPageBody(f.ctx, f.workspaceId, f.page.id);
	const doc = new Y.Doc();
	Y.applyUpdate(doc, stored.state);
	const [task] = await f.database.repositories.tasks.listByPage(
		f.scope,
		f.page.id,
	);
	if (!task) throw new Error("Missing task fixture");
	return {
		...f,
		doc,
		task,
		async close() {
			doc.destroy();
			await f.database.close();
		},
	};
}

test("task actions and appends merge with an older worker's unsaved typing", async () => {
	const f = await fixture();
	try {
		firstText(f.doc).insert(0, "Still typing. ");
		await updateTaskUseCase.run({
			ctx: f.ctx,
			input: {
				id: f.task.id,
				completed: true,
				dueDate: "2026-09-20",
				dueTime: "12:00",
				reminderOffsetMinutes: 15,
			},
		});
		await appendPageContentUseCase.run({
			ctx: f.ctx,
			input: { id: f.page.id, content: [paragraph("First append")] },
		});
		await appendPageContentUseCase.run({
			ctx: f.ctx,
			input: { id: f.page.id, content: [paragraph("Second append")] },
		});
		const saved = await persistPageBody(f.ctx, {
			workspaceId: f.workspaceId,
			pageId: f.page.id,
			baseRevision: 0,
			generation: 0,
			doc: f.doc,
		});
		Y.applyUpdate(f.doc, saved.state);
		const content = projectPageBody(f.doc);
		expect(JSON.stringify(content)).toContain("Still typing. Original text");
		expect(content[1]?.children[0]?.props).toMatchObject({
			checked: true,
			due: "2026-09-20",
			dueTime: "12:00",
			reminder: "15",
		});
		expect(
			content
				.slice(2)
				.map((block) => (block.content as { text: string }[])[0]?.text),
		).toEqual(["First append", "Second append"]);
		expect(
			(await f.database.repositories.pages.findById(f.scope, f.page.id))
				?.content,
		).toEqual(content);
		expect(receiptCoversDocument(f.doc, saved)).toBe(true);
	} finally {
		await f.close();
	}
});

test("sidebar child creation updates the collaborative parent and backlinks once", async () => {
	const f = await fixture();
	try {
		firstText(f.doc).insert(0, "Draft. ");
		const child = await createPageUseCase.run({
			ctx: f.ctx,
			input: {
				workspaceId: f.workspaceId,
				parentPageId: f.page.id,
				title: "Child",
			},
		});
		const saved = await persistPageBody(f.ctx, {
			workspaceId: f.workspaceId,
			pageId: f.page.id,
			baseRevision: 0,
			generation: 0,
			doc: f.doc,
		});
		Y.applyUpdate(f.doc, saved.state);
		const links = projectPageBody(f.doc).filter(
			(block) => block.id === child.id,
		);
		expect(links).toHaveLength(1);
		expect(links[0]).toMatchObject({
			type: "pageLink",
			props: { pageId: child.id },
		});
		expect(
			await f.database.repositories.pageLinks.listBacklinkSources(
				f.scope,
				child.id,
			),
		).toMatchObject([{ id: f.page.id }]);
		expect(firstText(f.doc).toString()).toBe("Draft. Original text");
	} finally {
		await f.close();
	}
});

test("a concurrent deletion stays deleted when an external append is merged", async () => {
	const f = await fixture();
	try {
		const group = f.doc.getXmlFragment("body").get(0) as Y.XmlElement;
		group.delete(0, 1);
		await appendPageContentUseCase.run({
			ctx: f.ctx,
			input: {
				id: f.page.id,
				content: [paragraph("Appended while disconnected")],
			},
		});
		const saved = await persistPageBody(f.ctx, {
			workspaceId: f.workspaceId,
			pageId: f.page.id,
			baseRevision: 0,
			generation: 0,
			doc: f.doc,
		});
		Y.applyUpdate(f.doc, saved.state);
		expect(JSON.stringify(projectPageBody(f.doc))).not.toContain(
			"Original text",
		);
		expect(JSON.stringify(projectPageBody(f.doc))).toContain(
			"Appended while disconnected",
		);
		expect(receiptCoversDocument(f.doc, saved)).toBe(true);
	} finally {
		await f.close();
	}
});

test("a missing collaborative task block rolls back the task-row mutation", async () => {
	const f = await fixture();
	try {
		const group = f.doc.getXmlFragment("body").get(0) as Y.XmlElement;
		group.delete(1, 1);
		// Simulate a stale derived task row; ordinary saves reconcile it away.
		await f.ctx.ports.uow.transaction((tx) =>
			tx.documents.commit(f.scope, {
				pageId: f.page.id,
				baseRevision: 0,
				generation: 0,
				state: Y.encodeStateAsUpdate(f.doc),
				contentJson: JSON.stringify(projectPageBody(f.doc)),
				searchText: "Original text",
			}),
		);
		await expect(
			updateTaskUseCase.run({
				ctx: f.ctx,
				input: { id: f.task.id, completed: true },
			}),
		).rejects.toMatchObject({ code: "TASK_NOT_EDITABLE" });
		expect(
			(await f.database.repositories.tasks.findById(f.scope, f.task.id))
				?.completed,
		).toBe(false);
	} finally {
		await f.close();
	}
});

test("invalid appends roll back binary state, SQL content and history together", async () => {
	const f = await fixture();
	try {
		const before = await f.database.repositories.documents.find(
			f.scope,
			f.page.id,
		);
		const beforePage = await f.database.repositories.pages.findById(
			f.scope,
			f.page.id,
		);
		const beforeHistory =
			await f.database.repositories.pageVersions.listMetaByPage(
				f.scope,
				f.page.id,
			);
		await expect(
			appendPageContentUseCase.run({
				ctx: f.ctx,
				input: {
					id: f.page.id,
					content: [
						{
							id: "invalid",
							type: "task",
							props: { assignee: "not-a-member" },
							content: [{ type: "text", text: "Bad assignment", styles: {} }],
							children: [],
						},
					],
				},
			}),
		).rejects.toMatchObject({ code: "INVALID_PAGE_CONTENT" });
		expect(
			await f.database.repositories.documents.find(f.scope, f.page.id),
		).toEqual(before);
		expect(
			await f.database.repositories.pages.findById(f.scope, f.page.id),
		).toEqual(beforePage);
		expect(
			await f.database.repositories.pageVersions.listMetaByPage(
				f.scope,
				f.page.id,
			),
		).toEqual(beforeHistory);
		await expect(
			appendPageContentUseCase.run({
				ctx: f.ctx,
				input: { id: f.page.id, content: [projectPageBody(f.doc)[0]!] },
			}),
		).rejects.toMatchObject({ code: "INVALID_PAGE_CONTENT" });
		expect(
			await f.database.repositories.documents.find(f.scope, f.page.id),
		).toEqual(before);
	} finally {
		await f.close();
	}
});

test("notification completion writes through to the collaborative task block", async () => {
	const f = await fixture();
	try {
		const notification =
			await f.database.repositories.notificationInbox.createTaskAssigned(
				{
					taskId: f.task.id,
					userId: f.userId,
					workspaceId: f.workspaceId,
					entityVersion: "fixture-assignment",
					title: f.task.title,
					assignedByUserId: f.userId,
					assignedByName: "Document User",
					pageId: f.page.id,
					sourceBlockId: "task-block",
				},
				new Date().toISOString(),
			);
		if (!notification) throw new Error("Missing notification fixture");
		await actOnTaskNotificationUseCase.run({
			ctx: f.ctx,
			input: { id: notification.id, action: "complete" },
		});
		const saved = await f.database.repositories.documents.find(
			f.scope,
			f.page.id,
		);
		Y.applyUpdate(f.doc, saved!.state);
		expect(projectPageBody(f.doc)[1]?.children[0]?.props.checked).toBe(true);
		expect(
			(await f.database.repositories.tasks.findById(f.scope, f.task.id))
				?.completed,
		).toBe(true);
		expect(
			(
				await f.database.repositories.notificationInbox.findByUser(
					f.userId,
					notification.id,
				)
			)?.actionState,
		).toBe("completed");
	} finally {
		await f.close();
	}
});

test("viewer and foreign-workspace writes cannot change a collaborative document", async () => {
	const f = await documentFixture("viewer");
	try {
		const before = await loadPageBody(f.ctx, f.workspaceId, f.page.id);
		await expect(
			appendPageContentUseCase.run({
				ctx: f.ctx,
				input: { id: f.page.id, content: [paragraph("Denied")] },
			}),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
		const foreign = createTenantScope({ id: "foreign" });
		await expect(
			f.ctx.ports.uow.transaction((tx) =>
				tx.pages.appendContent(foreign, f.page.id, [paragraph("Denied")]),
			),
		).rejects.toMatchObject({ code: "PAGE_NOT_FOUND" });
		expect(
			await f.database.repositories.documents.find(f.scope, f.page.id),
		).toEqual(before);
	} finally {
		await f.database.close();
	}
});

async function until(condition: () => boolean | Promise<boolean>) {
	const end = Date.now() + 6000;
	while (!(await condition())) {
		if (Date.now() > end)
			throw new Error("Timed out waiting for external document update");
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
}

test("an idle open editor receives MCP appends, task actions, and sidebar child creation", async () => {
	const f = await fixture();
	const tokens = createDocumentSessionTokens(
		"server-writes-test-secret-at-least-32-characters",
	);
	const engine = createDocumentServer({
		origin: "http://localhost:3000",
		verify: tokens.verify,
		async authorize(grant) {
			return {
				ctx: f.ctx,
				role: await checkDocumentAccess(grant, f.database.db),
			};
		},
	});
	const transport = listenDocumentServer(engine, {
		port: 0,
		hostname: "127.0.0.1",
		origin: "http://localhost:3000",
	});
	const provider = new HocuspocusProvider({
		url: `ws://127.0.0.1:${transport.port}`,
		name: pageDocumentName(f.workspaceId, f.page.id),
		token: tokens.issue(f.grant).token,
		document: f.doc,
	});
	try {
		await until(() => provider.isSynced);
		await appendToPageCapability.handle({
			capability: appendToPageCapability,
			ctx: f.ctx,
			principal: { agentId: "test-agent", userId: f.userId },
			input: {
				workspaceId: f.workspaceId,
				pageId: f.page.id,
				markdown: "MCP appended paragraph",
			},
		});
		await updateTaskUseCase.run({
			ctx: f.ctx,
			input: { id: f.task.id, completed: true },
		});
		const child = await createPageUseCase.run({
			ctx: f.ctx,
			input: {
				workspaceId: f.workspaceId,
				parentPageId: f.page.id,
				title: "Live child",
			},
		});
		await until(() => {
			const blocks = projectPageBody(f.doc);
			return (
				JSON.stringify(blocks).includes("MCP appended paragraph") &&
				blocks[1]?.children[0]?.props.checked === true &&
				blocks.some((block) => block.id === child.id)
			);
		});
		expect(
			projectPageBody(f.doc).filter((block) => block.id === child.id),
		).toHaveLength(1);
		firstText(f.doc).insert(0, "Typing after external updates. ");
		await until(async () =>
			JSON.stringify(
				(await f.database.repositories.pages.findById(f.scope, f.page.id))
					?.content,
			).includes("Typing after external updates."),
		);
		expect(
			(await f.database.repositories.tasks.findById(f.scope, f.task.id))
				?.completed,
		).toBe(true);
	} finally {
		provider.destroy();
		await stopDocumentServer(engine);
		await transport.stop(true);
		await f.close();
	}
}, 20_000);
