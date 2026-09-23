import { expect, test } from "bun:test";
import { createBetterAuthAgentCapabilityTestContext } from "@beignet/agent-auth-better-auth/testing";
import * as Y from "yjs";
import { createTestMcpConnectionRepository } from "@/features/agents/tests/helpers";
import type {
	McpConnectionActivityWrite,
	McpConnectionRow,
} from "@/features/agents/ports";
import { PageEditOutputSchema } from "@/features/pages/block-editing";
import { readPageDocumentUseCase } from "@/features/pages/use-cases/read-page-document";
import { restorePageVersionUseCase } from "@/features/pages/use-cases/restore-page-version";
import { updatePageUseCase } from "@/features/pages/use-cases/update-page";
import { loadPageBody, persistPageBody } from "@/infra/documents/persistence";
import { projectPageBody } from "@/infra/documents/codec";
import { checkDocumentAccess } from "@/infra/documents/access";
import {
	createHaunterAgentCapabilityExecutor,
	executeRemoteMcpCapability,
} from "@/server/agent-capabilities";
import { createHaunterAgentAuthAdapter } from "@/lib/agent-auth-adapter";
import { createRemoteMcpRequestHandler } from "@/server/remote-mcp";
import { DocumentRestoredError } from "../restoration";
import { createTestAgentAdminRepository } from "@/features/agents/tests/helpers";
import {
	documentFixture,
	firstText,
	paragraph,
	seedFixtureBody,
} from "./helpers";

async function fixture(
	profile: McpConnectionRow["permissionProfile"] = "full",
	role = "owner",
) {
	const f = await documentFixture(role);
	const body = [
		paragraph("Original paragraph", "intro"),
		{
			id: "task",
			type: "task",
			props: { checked: false, assignee: f.userId },
			content: [{ type: "text", text: "Original task", styles: {} }],
			children: [],
		},
		{
			id: "parent",
			type: "callout",
			props: {},
			content: [],
			children: [paragraph("Child", "child")],
		},
		{
			id: "canvas",
			type: "canvas",
			props: { canvasId: crypto.randomUUID() },
			children: [],
		},
	];
	await seedFixtureBody(f, body, true);
	const activities: McpConnectionActivityWrite[] = [];
	const connection: McpConnectionRow = {
		id: "connection",
		userId: f.userId,
		clientId: "client",
		clientName: "Test",
		permissionProfile: profile,
		status: "active",
		workspaceIds: [f.workspaceId],
		lastUsedAt: null,
		createdAt: new Date(),
		updatedAt: new Date(),
	};
	f.ctx.ports.mcpConnections = createTestMcpConnectionRepository(
		[connection],
		activities,
	);
	f.ctx.ports.workspaceEventStreamLeases = {
		isConfigured: () => false,
		acquire: async () => null,
	};
	const server = {
		ports: f.ctx.ports,
		createServiceContext: async () => f.ctx,
	};
	const execute = (capability: string, args: Record<string, unknown> = {}) =>
		executeRemoteMcpCapability(
			{
				capability,
				arguments: { workspaceId: f.workspaceId, pageId: f.page.id, ...args },
				userId: f.userId,
				clientId: "client",
			},
			{ getServer: async () => server },
		);
	const read = () =>
		readPageDocumentUseCase.run({ ctx: f.ctx, input: { id: f.page.id } });
	const edit = async (operations: unknown[], revision?: string) =>
		PageEditOutputSchema.parse(
			await execute("edit_page_blocks", {
				expectedRevision: revision ?? (await read()).revision,
				operations,
			}),
		);
	const replace = async (content: unknown, revision?: string) =>
		PageEditOutputSchema.parse(
			await execute("replace_page_content", {
				expectedRevision: revision ?? (await read()).revision,
				content,
			}),
		);
	return { ...f, activities, connection, execute, read, edit, replace, server };
}

const text = (value: string) => [
	{ type: "text" as const, text: value, styles: {} },
];

test("MCP reads preserve the default Markdown response and expose blocks and body-only revisions", async () => {
	const f = await fixture();
	try {
		const before = await f.read();
		const markdown = await f.execute("read_page");
		expect(markdown).toMatchObject({
			pageId: f.page.id,
			revision: before.revision,
		});
		expect(markdown).toHaveProperty("markdown");
		expect(markdown).not.toHaveProperty("blocks");
		expect(await f.execute("read_page", { format: "blocks" })).toEqual(before);
		expect(await f.execute("read_page", { format: "both" })).toMatchObject({
			...before,
			markdown: expect.any(String),
		});
		await updatePageUseCase.run({
			ctx: f.ctx,
			input: { id: f.page.id, title: "Renamed" },
		});
		expect((await f.read()).revision).toBe(before.revision);
	} finally {
		await f.database.close();
	}
});

test("a batch edits task text and props, inserts nested blocks, and preserves IDs and rich blocks", async () => {
	const f = await fixture("edit");
	try {
		const before = await f.read();
		const tasks = await f.database.repositories.tasks.listByPage(
			f.scope,
			f.page.id,
		);
		const saved = await f.edit([
			{
				op: "update",
				blockId: "task",
				content: text("Renamed task"),
				props: { checked: true, due: "2026-10-01" },
			},
			{
				op: "insert",
				parentBlockId: "parent",
				afterBlockId: "child",
				blocks: [{ type: "paragraph", content: text("New nested paragraph") }],
			},
		]);
		const after = await f.read();
		expect(after.revision).toBe(saved.revision);
		expect(after.blocks[0]).toEqual(before.blocks[0]);
		expect(after.blocks[3]).toEqual(before.blocks[3]);
		expect(after.blocks[2]?.children.map((block) => block.id)).toEqual([
			"child",
			...saved.insertedBlockIds,
		]);
		expect(
			await f.database.repositories.tasks.listByPage(f.scope, f.page.id),
		).toMatchObject([
			{
				id: tasks[0]?.id,
				title: "Renamed task",
				completed: true,
				assigneeId: f.userId,
				dueDate: "2026-10-01",
			},
		]);
		expect(
			(
				await f.database.repositories.pageVersions.findById(
					f.scope,
					saved.historyVersionId,
				)
			)?.content,
		).toEqual(before.blocks);
		expect(f.activities.at(-1)).toMatchObject({
			capability: "edit_page_blocks",
			status: "success",
			resourceId: f.page.id,
		});
	} finally {
		await f.database.close();
	}
});

test("invalid later operations and invalid task assignments roll back the entire batch and its history", async () => {
	const f = await fixture();
	try {
		const before = await f.read();
		const document = await loadPageBody(f.ctx, f.workspaceId, f.page.id);
		for (const invalid of [
			{ op: "delete", blockId: "missing" },
			{ op: "delete", blockId: "parent" },
			{ op: "update", blockId: "canvas", props: { canvasId: "new" } },
			{ op: "update", blockId: "task", props: { assignee: "foreign-user" } },
			{ op: "update", blockId: "intro", props: { misspelled: true } },
			{
				op: "insert",
				parentBlockId: "parent",
				afterBlockId: "intro",
				blocks: [{ type: "paragraph" }],
			},
		]) {
			await expect(
				f.edit(
					[
						{ op: "update", blockId: "intro", content: text("Must roll back") },
						invalid,
					],
					before.revision,
				),
			).rejects.toMatchObject({ code: "INVALID_PAGE_CONTENT" });
			expect(await f.read()).toEqual(before);
			expect(await loadPageBody(f.ctx, f.workspaceId, f.page.id)).toEqual(
				document,
			);
			expect(
				await f.database.repositories.pageVersions.listMetaByPage(
					f.scope,
					f.page.id,
				),
			).toHaveLength(0);
		}
	} finally {
		await f.database.close();
	}
});

test("stale revisions reject both writes without creating extra snapshots", async () => {
	const f = await fixture();
	try {
		const before = await f.read();
		await f.edit(
			[{ op: "update", blockId: "intro", content: text("Updated") }],
			before.revision,
		);
		const current = await f.read();
		await expect(
			f.edit([{ op: "delete", blockId: "intro" }], before.revision),
		).rejects.toMatchObject({
			code: "REVISION_CONFLICT",
			details: { currentRevision: current.revision },
		});
		await expect(
			f.replace({ format: "markdown", markdown: "Outdated" }, before.revision),
		).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
		expect(await f.read()).toEqual(current);
		expect(
			await f.database.repositories.pageVersions.listMetaByPage(
				f.scope,
				f.page.id,
			),
		).toHaveLength(1);
	} finally {
		await f.database.close();
	}
});

test("Full access is required for deletion and replacement, and membership still gates writes", async () => {
	const f = await fixture("edit");
	try {
		const before = await f.read();
		await expect(
			f.edit([
				{ op: "update", blockId: "intro", content: text("No") },
				{ op: "delete", blockId: "task" },
			]),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
		await expect(
			f.replace({ format: "markdown", markdown: "No" }),
		).rejects.toMatchObject({ status: "FORBIDDEN" });
		f.connection.permissionProfile = "view";
		await expect(
			f.edit([{ op: "update", blockId: "intro", content: text("No") }]),
		).rejects.toMatchObject({ status: "FORBIDDEN" });
		f.connection.permissionProfile = "full";
		f.ctx.membership = { role: "viewer" };
		await expect(
			f.edit([{ op: "delete", blockId: "task" }]),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
		await expect(
			f.replace({ format: "markdown", markdown: "No" }),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
		expect(await f.read()).toEqual(before);
		await expect(
			f.execute("read_page", { workspaceId: "foreign" }),
		).rejects.toThrow();
	} finally {
		await f.database.close();
	}
});

test("deletion removes embedded tasks and explicit subtrees and returns a recoverable version", async () => {
	const f = await fixture();
	try {
		const before = await f.read();
		const saved = await f.edit([
			{ op: "delete", blockId: "task" },
			{ op: "delete", blockId: "parent", deleteChildren: true },
		]);
		expect((await f.read()).blocks.map((block) => block.id)).toEqual([
			"intro",
			"canvas",
		]);
		expect(
			await f.database.repositories.tasks.listByPage(f.scope, f.page.id),
		).toHaveLength(0);
		await restorePageVersionUseCase.run({
			ctx: f.ctx,
			input: { id: f.page.id, versionId: saved.historyVersionId },
		});
		expect((await f.read()).blocks).toEqual(before.blocks);
	} finally {
		await f.database.close();
	}
});

test("replacement preserves metadata, snapshots every call, and prevents old offline clients from merging back", async () => {
	const f = await fixture();
	const oldClient = new Y.Doc();
	try {
		const before = await f.read();
		Y.applyUpdate(
			oldClient,
			(await loadPageBody(f.ctx, f.workspaceId, f.page.id)).state,
		);
		firstText(oldClient).insert(0, "Offline draft ");
		const saved = await f.replace({
			format: "markdown",
			markdown: "## New body\n\n- [ ] New task",
		});
		expect((await f.read()).title).toBe(before.title);
		expect(JSON.stringify((await f.read()).blocks)).toContain("New body");
		expect(
			(
				await f.database.repositories.pageVersions.findById(
					f.scope,
					saved.historyVersionId,
				)
			)?.content,
		).toEqual(before.blocks);
		await expect(
			persistPageBody(f.ctx, {
				workspaceId: f.workspaceId,
				pageId: f.page.id,
				baseRevision: 0,
				generation: 0,
				doc: oldClient,
			}),
		).rejects.toBeInstanceOf(DocumentRestoredError);
		await expect(
			checkDocumentAccess(f.grant, f.database.db),
		).rejects.toBeInstanceOf(DocumentRestoredError);
		const cleared = await f.replace({ format: "markdown", markdown: "" });
		expect(cleared.revision).not.toBe(saved.revision);
		expect(
			await f.database.repositories.pageVersions.listMetaByPage(
				f.scope,
				f.page.id,
			),
		).toHaveLength(2);
		expect(
			await f.database.repositories.tasks.listByPage(f.scope, f.page.id),
		).toHaveLength(0);
		expect((await f.read()).blocks).toMatchObject([
			{ type: "paragraph", content: [] },
		]);
	} finally {
		oldClient.destroy();
		await f.database.close();
	}
});

test("structured replacement retains task IDs and untouched rich content; malformed replacements roll back", async () => {
	const f = await fixture();
	try {
		const before = await f.read();
		const task = (
			await f.database.repositories.tasks.listByPage(f.scope, f.page.id)
		)[0];
		const blocks = structuredClone(before.blocks);
		if (!blocks[0]) throw new Error("Missing fixture");
		blocks[0].content = text("Revised introduction");
		await f.replace({ format: "blocks", blocks });
		expect((await f.read()).blocks).toEqual(blocks);
		expect(
			(await f.database.repositories.tasks.listByPage(f.scope, f.page.id))[0]
				?.id,
		).toBe(task?.id);
		const current = await f.read();
		for (const invalid of [
			[...blocks, blocks[0]],
			[
				...blocks,
				{
					id: "new-canvas",
					type: "canvas",
					props: { canvasId: "unknown" },
					children: [],
				},
			],
			[
				{
					id: "bad",
					type: "paragraph",
					props: { unsupported: true },
					content: [],
					children: [],
				},
			],
		]) {
			await expect(
				f.replace({ format: "blocks", blocks: invalid }),
			).rejects.toMatchObject({ code: "INVALID_PAGE_CONTENT" });
			expect(await f.read()).toEqual(current);
		}
	} finally {
		await f.database.close();
	}
});

test("targeted edits merge with unsaved typing in an untouched block", async () => {
	const f = await fixture();
	const client = new Y.Doc();
	try {
		Y.applyUpdate(
			client,
			(await loadPageBody(f.ctx, f.workspaceId, f.page.id)).state,
		);
		firstText(client).insert(0, "Still typing. ");
		await f.edit([
			{ op: "update", blockId: "task", content: text("Agent revision") },
			{
				op: "insert",
				afterBlockId: "task",
				blocks: [{ type: "paragraph", content: text("Inserted") }],
			},
		]);
		const saved = await persistPageBody(f.ctx, {
			workspaceId: f.workspaceId,
			pageId: f.page.id,
			baseRevision: 0,
			generation: 0,
			doc: client,
		});
		Y.applyUpdate(client, saved.state);
		const content = projectPageBody(client);
		expect(JSON.stringify(content)).toContain(
			"Still typing. Original paragraph",
		);
		expect(JSON.stringify(content)).toContain("Agent revision");
		expect(JSON.stringify(content)).toContain("Inserted");
		expect((await f.read()).blocks).toEqual(content);
	} finally {
		client.destroy();
		await f.database.close();
	}
});

test.each([
	{
		name: "replacement",
		content: text("Revised paragraph"),
		expected: "Revised paragraph",
	},
	{ name: "clearing", content: [], expected: "" },
	{
		name: "unchanged text",
		content: text("Original paragraph"),
		expected: "Original paragraph",
	},
	{
		name: "formatting",
		content: [
			{ type: "text", text: "Original paragraph", styles: { bold: true } },
		],
		expected: "Original paragraph",
	},
])(
	"$name preserves unsaved typing in the same paragraph",
	async ({ content, expected }) => {
		const f = await fixture();
		const client = new Y.Doc();
		try {
			const original = await loadPageBody(f.ctx, f.workspaceId, f.page.id);
			Y.applyUpdate(client, original.state);
			const pending = " User's unsaved sentence. 🐱";
			const typing = firstText(client);
			typing.insert(typing.length, pending);
			await f.edit([{ op: "update", blockId: "intro", content }]);
			const saved = await persistPageBody(f.ctx, {
				workspaceId: f.workspaceId,
				pageId: f.page.id,
				baseRevision: original.revision,
				generation: original.generation,
				doc: client,
			});
			Y.applyUpdate(client, saved.state);
			const blocks = projectPageBody(client);
			const inline = blocks[0]?.content as { text: string }[];
			expect(inline.map((part) => part.text).join("")).toBe(expected + pending);
			expect((await f.read()).blocks).toEqual(blocks);
			if (content[0] && "bold" in content[0].styles && content[0].styles.bold)
				expect(inline[0]).toMatchObject({ styles: { bold: true } });
		} finally {
			client.destroy();
			await f.database.close();
		}
	},
);

test.each(["line break", "mention"])(
	"removing a %s preserves typing in every text segment",
	async (separator) => {
		for (const replacement of [text("Rewritten"), []]) {
			const f = await fixture();
			const client = new Y.Doc();
			try {
				const content =
					separator === "line break"
						? text("First\nSecond")
						: [
								...text("First"),
								{
									type: "mention",
									props: { pageId: f.page.id, workspaceId: f.workspaceId },
								},
								...text("Second"),
							];
				await seedFixtureBody(f, [{ ...paragraph("", "intro"), content }]);
				const original = await loadPageBody(f.ctx, f.workspaceId, f.page.id);
				Y.applyUpdate(client, original.state);
				const segments = Array.from(
					client
						.getXmlFragment("body")
						.createTreeWalker((node) => node instanceof Y.XmlText),
				) as Y.XmlText[];
				segments[0]!.insert(0, "Prefix. ");
				const last = segments.at(-1)!;
				last.insert(last.length, " Unsaved suffix.");
				await f.edit([
					{ op: "update", blockId: "intro", content: replacement },
				]);
				const saved = await persistPageBody(f.ctx, {
					workspaceId: f.workspaceId,
					pageId: f.page.id,
					baseRevision: original.revision,
					generation: original.generation,
					doc: client,
				});
				Y.applyUpdate(client, saved.state);
				const blocks = projectPageBody(client);
				const inline = blocks[0]?.content as { text: string }[];
				const merged = inline.map((part) => part.text).join("");
				expect(merged).toContain("Prefix. ");
				expect(merged).toContain(" Unsaved suffix.");
				expect(merged).toContain(replacement[0]?.text ?? "");
				expect(merged).not.toContain("First");
				expect(merged).not.toContain("Second");
				expect((await f.read()).blocks).toEqual(blocks);
			} finally {
				client.destroy();
				await f.database.close();
			}
		}
	},
);

test("repeated inline edits apply and remove marks, links, mentions, line breaks, and emoji", async () => {
	const f = await fixture();
	try {
		const rich = [
			{
				type: "text",
				text: "Styled 🐱",
				styles: { bold: true, textColor: "red" },
			},
			{ type: "link", href: "https://example.com", content: text("Linked") },
			{
				type: "mention",
				props: { pageId: f.page.id, workspaceId: f.workspaceId },
			},
			...text("\nAfter mention"),
		];
		await f.edit([{ op: "update", blockId: "intro", content: rich }]);
		expect((await f.read()).blocks[0]?.content).toEqual(rich);
		await f.edit([
			{ op: "update", blockId: "intro", content: text("Styled 🐶") },
		]);
		expect((await f.read()).blocks[0]?.content).toEqual(text("Styled 🐶"));
		await f.edit([{ op: "update", blockId: "intro", content: rich }]);
		expect((await f.read()).blocks[0]?.content).toEqual(rich);
	} finally {
		await f.database.close();
	}
});

test("code blocks support text and language edits, insertion, and both replacement formats", async () => {
	const f = await fixture();
	try {
		await seedFixtureBody(f, [
			{
				...paragraph("const x = 1;", "code"),
				type: "codeBlock",
				props: { language: "typescript" },
			},
		]);
		await f.edit([
			{
				op: "update",
				blockId: "code",
				content: text("const x = 2;\nconsole.log(x);"),
			},
		]);
		await f.edit([
			{ op: "update", blockId: "code", props: { language: "javascript" } },
		]);
		expect((await f.read()).blocks[0]).toMatchObject({
			id: "code",
			type: "codeBlock",
			props: { language: "javascript" },
			content: text("const x = 2;\nconsole.log(x);"),
		});
		const inserted = await f.edit([
			{
				op: "insert",
				afterBlockId: "code",
				blocks: [
					{
						type: "codeBlock",
						props: { language: "sql" },
						content: text("select 1;"),
					},
				],
			},
		]);
		const before = await f.read();
		expect(before.blocks[1]).toMatchObject({
			id: inserted.insertedBlockIds[0],
			type: "codeBlock",
			content: text("select 1;"),
		});
		await f.replace({ format: "blocks", blocks: before.blocks });
		expect((await f.read()).blocks).toEqual(before.blocks);
		await f.replace({
			format: "markdown",
			markdown: "```js\nconst x = 3;\n```",
		});
		expect((await f.read()).blocks[0]).toMatchObject({
			type: "codeBlock",
			props: { language: "javascript" },
			content: text("const x = 3;"),
		});
	} finally {
		await f.database.close();
	}
});

test("code blocks reject rich inline content without dropping formatting or links", async () => {
	const f = await fixture();
	try {
		await seedFixtureBody(f, [
			{
				...paragraph("select 1;", "code"),
				type: "codeBlock",
				props: { language: "sql" },
			},
		]);
		const before = await f.read();
		for (const content of [
			[{ type: "text", text: "bold", styles: { bold: true } }],
			[{ type: "link", href: "https://example.com", content: text("link") }],
			[
				{
					type: "mention",
					props: { pageId: f.page.id, workspaceId: f.workspaceId },
				},
			],
		]) {
			await expect(
				f.edit([{ op: "update", blockId: "code", content }]),
			).rejects.toMatchObject({ code: "INVALID_PAGE_CONTENT" });
			await expect(
				f.replace({
					format: "blocks",
					blocks: [{ ...before.blocks[0], content }],
				}),
			).rejects.toMatchObject({ code: "INVALID_PAGE_CONTENT" });
			expect(await f.read()).toEqual(before);
		}
	} finally {
		await f.database.close();
	}
});

test("numbered lists retain custom starts through insertion, edits, and replacement", async () => {
	const f = await fixture();
	try {
		await seedFixtureBody(f, [
			{
				...paragraph("Third item", "numbered"),
				type: "numberedListItem",
				props: { start: 3 },
			},
		]);
		await f.edit([
			{
				op: "update",
				blockId: "numbered",
				content: text("Revised third item"),
			},
		]);
		expect((await f.read()).blocks[0]).toMatchObject({
			props: { start: 3 },
			content: text("Revised third item"),
		});
		await f.edit([
			{ op: "update", blockId: "numbered", props: { start: 5 } },
			{
				op: "insert",
				afterBlockId: "numbered",
				blocks: [
					{
						type: "numberedListItem",
						props: { start: 8 },
						content: text("Eighth item"),
					},
					{ type: "numberedListItem", content: text("Default start") },
				],
			},
		]);
		const before = await f.read();
		expect(before.blocks[0]?.props.start).toBe(5);
		expect(before.blocks[1]?.props.start).toBe(8);
		await f.replace({ format: "blocks", blocks: before.blocks });
		expect((await f.read()).blocks).toEqual(before.blocks);
		for (const start of ["3", true]) {
			await expect(
				f.edit([{ op: "update", blockId: "numbered", props: { start } }]),
			).rejects.toMatchObject({ code: "INVALID_PAGE_CONTENT" });
		}
	} finally {
		await f.database.close();
	}
});

test("Agent Auth deletion requires an effective replacement grant for the same resource", async () => {
	const f = await fixture();
	try {
		f.ctx.ports.agents = createTestAgentAdminRepository();
		const executor = await createHaunterAgentCapabilityExecutor({
			getServer: async () => f.server,
		});
		const adapter = createHaunterAgentAuthAdapter(executor);
		const onExecute = adapter.onExecute;
		if (!onExecute) throw new Error("Missing Agent Auth executor");
		const before = await f.read();
		const run = (
			constraints: Record<
				string,
				string | { eq: string } | { in: string[] }
			> | null,
			status = "active",
		) => {
			const context = createBetterAuthAgentCapabilityTestContext({
				capability: "edit_page_blocks",
				userId: f.userId,
				constraints: { workspaceId: f.workspaceId },
				arguments: {
					workspaceId: f.workspaceId,
					pageId: f.page.id,
					expectedRevision: before.revision,
					operations: [{ op: "delete", blockId: "task" }],
				},
			});
			context.agentSession.agent.capabilityGrants.push({
				capability: "replace_page_content",
				status,
				constraints,
				grantedBy: f.userId,
			});
			return onExecute(context);
		};
		const deniedConstraints: Array<Record<string, string> | null> = [
			null,
			{ workspaceId: "foreign" },
			{ workspaceId: f.workspaceId, pageId: crypto.randomUUID() },
			{ workspaceId: f.workspaceId, title: "extra constraint" },
		];
		for (const constraints of deniedConstraints) {
			await expect(run(constraints)).rejects.toMatchObject({
				body: { error: "FORBIDDEN" },
			});
			expect(await f.read()).toEqual(before);
		}
		await expect(
			run({ workspaceId: f.workspaceId }, "revoked"),
		).rejects.toMatchObject({ body: { error: "FORBIDDEN" } });
		await run({
			workspaceId: { in: [f.workspaceId] },
			pageId: { eq: f.page.id },
		});
		expect((await f.read()).blocks.some((block) => block.id === "task")).toBe(
			false,
		);
	} finally {
		await f.database.close();
	}
});

test("insertions reconcile new tasks and backlinks; deletion clears both projections", async () => {
	const f = await fixture();
	try {
		const target = await f.database.repositories.pages.create(f.scope, {
			userId: f.userId,
			title: "Linked page",
			parentPageId: null,
			position: 1,
		});
		const inserted = await f.edit([
			{
				op: "insert",
				afterBlockId: "intro",
				blocks: [
					{ type: "task", content: text("New action item") },
					{
						type: "pageLink",
						props: { pageId: target.id, workspaceId: f.workspaceId },
					},
				],
			},
		]);
		expect(inserted).toMatchObject({ tasksChanged: true, linksChanged: true });
		expect(
			await f.database.repositories.pageLinks.listBacklinkSources(
				f.scope,
				target.id,
			),
		).toMatchObject([{ id: f.page.id }]);
		expect(
			await f.database.repositories.tasks.listByPage(f.scope, f.page.id),
		).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					title: "New action item",
					assigneeId: f.userId,
				}),
			]),
		);
		await f.edit(
			inserted.insertedBlockIds.map((blockId) => ({ op: "delete", blockId })),
		);
		expect(
			await f.database.repositories.pageLinks.listBacklinkSources(
				f.scope,
				target.id,
			),
		).toHaveLength(0);
		expect(
			await f.database.repositories.tasks.listByPage(f.scope, f.page.id),
		).toHaveLength(1);
	} finally {
		await f.database.close();
	}
});

test("malformed tool input cannot bypass revision checks, operation limits, or block identity", async () => {
	const f = await fixture();
	try {
		const before = await f.read();
		const operation = {
			op: "update",
			blockId: "intro",
			content: text("Changed"),
		};
		for (const args of [
			{ operations: [operation] },
			{
				expectedRevision: before.revision,
				operations: Array.from({ length: 101 }, () => operation),
			},
			{
				expectedRevision: before.revision,
				operations: [{ ...operation, children: [] }],
			},
			{
				expectedRevision: before.revision,
				operations: [
					{
						op: "insert",
						afterBlockId: null,
						blocks: [{ id: "intro", type: "paragraph" }],
					},
				],
			},
		])
			await expect(f.execute("edit_page_blocks", args)).rejects.toThrow();
		expect(await f.read()).toEqual(before);
	} finally {
		await f.database.close();
	}
});

test("MCP protocol advertises the tools and returns structured reads and actionable revision conflicts", async () => {
	const f = await fixture();
	try {
		const handler = createRemoteMcpRequestHandler({
			connection: f.connection,
			identity: { userId: f.userId, clientId: "client" },
			getServer: async () => f.server,
		});
		const request = async (
			method: string,
			params: Record<string, unknown> = {},
		) => {
			const response = await handler(
				new Request("http://localhost/mcp", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Accept: "application/json, text/event-stream",
					},
					body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
				}),
			);
			expect(response.status).toBe(200);
			const body = await response.text();
			const payload = body.startsWith("{")
				? body
				: body
						.split("\n")
						.find((line) => line.startsWith("data: "))
						?.slice(6);
			if (!payload) throw new Error("Missing MCP response");
			return JSON.parse(payload);
		};
		const tools = await request("tools/list");
		expect(tools.result.tools).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ name: "edit_page_blocks" }),
				expect.objectContaining({ name: "replace_page_content" }),
			]),
		);
		const read = await request("tools/call", {
			name: "read_page",
			arguments: {
				workspaceId: f.workspaceId,
				pageId: f.page.id,
				format: "blocks",
			},
		});
		expect(read.result.isError).not.toBe(true);
		expect(read.result.structuredContent).toEqual(await f.read());
		await f.edit([
			{ op: "update", blockId: "intro", content: text("Fresh content") },
		]);
		const stale = await request("tools/call", {
			name: "replace_page_content",
			arguments: {
				workspaceId: f.workspaceId,
				pageId: f.page.id,
				expectedRevision: read.result.structuredContent.revision,
				content: { format: "markdown", markdown: "Stale" },
			},
		});
		expect(stale.result.isError).toBe(true);
		expect(JSON.parse(stale.result.content[0].text)).toMatchObject({
			code: "REVISION_CONFLICT",
			currentRevision: (await f.read()).revision,
		});
	} finally {
		await f.database.close();
	}
});

test("tables and attachments survive targeted edits and structured replacement without loss", async () => {
	const f = await fixture();
	try {
		await seedFixtureBody(f, [
			paragraph("Introduction", "intro"),
			{
				id: "table",
				type: "table",
				props: {},
				content: {
					type: "tableContent",
					columnWidths: [180],
					headerRows: 1,
					rows: [{ cells: [text("Metric")] }],
				},
				children: [],
			},
			{
				id: "image",
				type: "image",
				props: {
					url: "/api/files/image.png",
					name: "Chart",
					caption: "Results",
					previewWidth: 320,
				},
				children: [],
			},
			{
				id: "file",
				type: "file",
				props: { url: "/api/files/example.txt", name: "Example" },
				children: [],
			},
		]);
		const before = await f.read();
		await f.edit([
			{
				op: "update",
				blockId: "intro",
				content: [
					{
						type: "text",
						text: "Formatted",
						styles: { bold: true, underline: true },
					},
					{ type: "link", href: "https://example.com", content: text("Link") },
				],
			},
		]);
		const edited = await f.read();
		expect(edited.blocks.slice(1)).toEqual(before.blocks.slice(1));
		await f.replace({ format: "blocks", blocks: edited.blocks });
		expect((await f.read()).blocks).toEqual(edited.blocks);
	} finally {
		await f.database.close();
	}
});
