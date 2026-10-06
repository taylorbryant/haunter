import { expect, test } from "bun:test";
import { createRecordingBestEffortWork } from "@beignet/core/testing";
import { createBetterAuthAgentCapabilityTestContext } from "@beignet/agent-auth-better-auth/testing";
import { z } from "zod";
import type { McpConnectionRow } from "@/features/agents/ports";
import {
	createTestMcpConnectionRepository,
	createTestAgentAdminRepository,
} from "@/features/agents/tests/helpers";
import {
	PageDocumentOutputSchema,
	PageEditOutputSchema,
	EditableTableContentSchema,
} from "@/features/pages/block-editing";
import { readPageDocumentUseCase } from "@/features/pages/use-cases/read-page-document";
import {
	executeRemoteMcpCapability,
	createHaunterAgentCapabilityExecutor,
} from "@/server/agent-capabilities";
import { createHaunterAgentAuthAdapter } from "@/lib/agent-auth-adapter";
import { createRemoteMcpRequestHandler } from "@/server/remote-mcp";
import { documentFixture, paragraph, seedFixtureBody } from "./helpers";

const text = (value: string) => [
	{ type: "text" as const, text: value, styles: {} },
];
const table = () => ({
	type: "table" as const,
	props: {},
	content: {
		type: "tableContent" as const,
		columnWidths: [180, 240],
		headerRows: 1,
		rows: [
			{ cells: [text("Name"), text("Status")] },
			{ cells: [text("Alpha"), text("Draft")] },
		],
	},
});

async function fixture(
	profile: McpConnectionRow["permissionProfile"] = "full",
) {
	const f = await documentFixture();
	await seedFixtureBody(f, [
		paragraph("Keep me", "intro"),
		{ ...table(), id: "table", children: [] },
	]);
	const connection: McpConnectionRow = {
		id: "connection",
		userId: f.userId,
		clientId: "client",
		clientName: "Table test",
		permissionProfile: profile,
		status: "active",
		workspaceIds: [f.workspaceId],
		lastUsedAt: null,
		createdAt: new Date(),
		updatedAt: new Date(),
	};
	f.ctx.ports.mcpConnections = createTestMcpConnectionRepository([connection]);
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
	const edit = async (operations: unknown[], expectedRevision?: string) =>
		PageEditOutputSchema.parse(
			await execute("edit_page_blocks", {
				operations,
				expectedRevision: expectedRevision ?? (await read()).revision,
			}),
		);
	return { ...f, server, connection, execute, read, edit };
}

test("MCP creates tables and edits cells, rows, and columns with history and live updates", async () => {
	const f = await fixture();
	try {
		const before = await f.read();
		const work = createRecordingBestEffortWork();
		f.ctx.ports.bestEffortWork = work.bestEffortWork;
		const events: unknown[] = [];
		f.ctx.ports.broadcast = {
			async publish(_channel, message) {
				events.push(message.data);
			},
			subscribe() {
				throw new Error("Publish-only fixture");
			},
		};
		const inserted = await f.edit([
			{ op: "insert", afterBlockId: "table", blocks: [table()] },
		]);
		expect(inserted.insertedBlockIds).toHaveLength(1);
		const result = await f.edit([
			{
				op: "update_table_cell",
				blockId: "table",
				row: 1,
				column: 1,
				content: [{ type: "text", text: "Ready", styles: { bold: true } }],
			},
			{
				op: "insert_table_row",
				blockId: "table",
				index: 1,
				cells: [text("Beta"), text("Review")],
			},
			{
				op: "insert_table_column",
				blockId: "table",
				index: 1,
				width: 120,
				cells: [text("Owner"), text("Bee"), text("Ace")],
			},
		]);
		const after = await f.read();
		const content = EditableTableContentSchema.parse(after.blocks[1]!.content);
		expect(after.blocks[0]).toEqual(before.blocks[0]);
		expect(after.blocks[1]!.id).toBe("table");
		expect(content).toMatchObject({
			columnWidths: [180, 120, 240],
			headerRows: 1,
			rows: [
				{
					cells: [
						{ content: text("Name") },
						{ content: text("Owner") },
						{ content: text("Status") },
					],
				},
				{
					cells: [
						{ content: text("Beta") },
						{ content: text("Bee") },
						{ content: text("Review") },
					],
				},
				{
					cells: [
						{ content: text("Alpha") },
						{ content: text("Ace") },
						{ content: [{ text: "Ready", styles: { bold: true } }] },
					],
				},
			],
		});
		expect(
			(await f.database.repositories.documents.find(f.scope, f.page.id))
				?.generation,
		).toBe(0);
		expect(
			(
				await f.database.repositories.pageVersions.findById(
					f.scope,
					result.historyVersionId,
				)
			)?.content.slice(0, 2),
		).toEqual(before.blocks);
		await work.flush();
		expect(events).toHaveLength(2);
		expect(events[1]).toMatchObject({
			type: "page.contentChanged",
			pageId: f.page.id,
		});
		await f.edit([
			{ op: "delete_table_row", blockId: "table", index: 1 },
			{ op: "delete_table_column", blockId: "table", index: 1 },
		]);
		const final = EditableTableContentSchema.parse(
			(await f.read()).blocks[1]!.content,
		);
		expect(final).toMatchObject({
			columnWidths: [180, 240],
			rows: [
				{ cells: [{ content: text("Name") }, { content: text("Status") }] },
				{
					cells: [{ content: text("Alpha") }, { content: [{ text: "Ready" }] }],
				},
			],
		});
		await expect(
			f.edit(
				[
					{
						op: "update_table_cell",
						blockId: "table",
						row: 0,
						column: 0,
						content: [],
					},
				],
				before.revision,
			),
		).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
	} finally {
		await f.database.close();
	}
});

test("table cell text is searchable and mentions reconcile backlinks", async () => {
	const f = await fixture();
	try {
		const target = await f.database.repositories.pages.create(f.scope, {
			userId: f.userId,
			title: "Linked",
			parentPageId: null,
			position: 1,
		});
		await f.edit([
			{
				op: "update_table_cell",
				blockId: "table",
				row: 1,
				column: 0,
				content: [
					...text("quartzneedle"),
					{
						type: "mention",
						props: { pageId: target.id, workspaceId: f.workspaceId },
					},
				],
			},
		]);
		expect(
			await f.execute("search_pages", { query: "quartzneedle" }),
		).toMatchObject({ pages: [{ pageId: f.page.id }] });
		expect(
			await f.execute("list_backlinks", { pageId: target.id }),
		).toMatchObject({ pages: [{ pageId: f.page.id }] });
		await f.edit([{ op: "delete_table_row", blockId: "table", index: 1 }]);
		expect(await f.execute("list_backlinks", { pageId: target.id })).toEqual({
			pages: [],
		});
	} finally {
		await f.database.close();
	}
});

test("invalid table operations roll back preceding edits and their history", async () => {
	const f = await fixture();
	try {
		const before = await f.read();
		const invalid = [
			{
				op: "update_table_cell",
				blockId: "intro",
				row: 0,
				column: 0,
				content: [],
			},
			{
				op: "update_table_cell",
				blockId: "missing",
				row: 0,
				column: 0,
				content: [],
			},
			{
				op: "update_table_cell",
				blockId: "table",
				row: 2,
				column: 0,
				content: [],
			},
			{ op: "insert_table_row", blockId: "table", index: 3, cells: [[], []] },
			{ op: "insert_table_column", blockId: "table", index: 0, cells: [[]] },
			{ op: "delete_table_row", blockId: "table", index: 2 },
			{ op: "delete_table_column", blockId: "table", index: -1 },
			{ op: "update", blockId: "table", content: [] },
			{
				op: "insert",
				afterBlockId: "table",
				blocks: [
					{
						type: "table",
						content: {
							type: "tableContent",
							rows: [{ cells: [[], []] }, { cells: [[]] }],
						},
					},
				],
			},
			{
				op: "insert",
				afterBlockId: "table",
				blocks: [
					{
						type: "table",
						content: {
							type: "tableContent",
							headerRows: 2,
							rows: [{ cells: [[]] }],
						},
					},
				],
			},
		];
		for (const operation of invalid) {
			await expect(
				f.edit([
					{
						op: "update_table_cell",
						blockId: "table",
						row: 0,
						column: 0,
						content: text("Rollback"),
					},
					operation,
				]),
			).rejects.toThrow();
			expect(await f.read()).toEqual(before);
			expect(
				await f.database.repositories.pageVersions.listMetaByPage(
					f.scope,
					f.page.id,
				),
			).toHaveLength(0);
		}
		await expect(
			f.edit([
				{ op: "delete_table_row", blockId: "table", index: 0 },
				{ op: "delete_table_row", blockId: "table", index: 0 },
			]),
		).rejects.toMatchObject({ code: "INVALID_PAGE_CONTENT" });
		await expect(
			f.edit([
				{ op: "delete_table_column", blockId: "table", index: 0 },
				{ op: "delete_table_column", blockId: "table", index: 0 },
			]),
		).rejects.toMatchObject({ code: "INVALID_PAGE_CONTENT" });
		expect(await f.read()).toEqual(before);
	} finally {
		await f.database.close();
	}
});

test("table deletions require Full access and all edits require current workspace membership", async () => {
	const f = await fixture("edit");
	try {
		await f.edit([
			{
				op: "update_table_cell",
				blockId: "table",
				row: 0,
				column: 0,
				content: text("Allowed"),
			},
		]);
		const before = await f.read();
		for (const op of ["delete_table_row", "delete_table_column"])
			await expect(
				f.edit([{ op, blockId: "table", index: 0 }]),
			).rejects.toMatchObject({ code: "FORBIDDEN" });
		f.connection.permissionProfile = "view";
		await expect(
			f.edit([
				{ op: "insert_table_row", blockId: "table", index: 0, cells: [[], []] },
			]),
		).rejects.toMatchObject({ status: "FORBIDDEN" });
		f.connection.permissionProfile = "full";
		f.ctx.ports.members.findRole = async () => null;
		await expect(
			f.edit([
				{
					op: "update_table_cell",
					blockId: "table",
					row: 0,
					column: 0,
					content: [],
				},
			]),
		).rejects.toThrow();
		expect(await f.read()).toEqual(before);
	} finally {
		await f.database.close();
	}
});

test("MCP HTTP exposes table operations and Markdown page creation reads back as a table", async () => {
	const f = await fixture();
	try {
		const handler = createRemoteMcpRequestHandler({
			connection: f.connection,
			identity: { userId: f.userId, clientId: "client" },
			getServer: async () => f.server,
		});
		const call = async (id: number, method: string, params: unknown) => {
			const response = await handler(
				new Request("http://haunter.test/api/mcp", {
					method: "POST",
					headers: {
						"content-type": "application/json",
						accept: "application/json, text/event-stream",
					},
					body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
				}),
			);
			const body = await response.text();
			return JSON.parse(
				body.startsWith("data:") || body.startsWith("event:")
					? body
							.split("\n")
							.find((line) => line.startsWith("data:"))!
							.slice(5)
					: body,
			);
		};
		const tools = await call(1, "tools/list", {});
		expect(JSON.stringify(tools.result)).toContain("update_table_cell");
		expect(JSON.stringify(tools.result)).toContain("insert_table_column");
		const created = z
			.object({ pageId: z.uuid() })
			.parse(
				await f.execute("create_page", {
					title: "Comparison",
					markdown: "| Option | Status |\n| --- | --- |\n| One | Ready |",
				}),
			);
		const body = PageDocumentOutputSchema.parse(
			await f.execute("read_page", {
				pageId: created.pageId,
				format: "blocks",
			}),
		);
		expect(body.blocks[0]?.type).toBe("table");
		const result = await call(2, "tools/call", {
			name: "edit_page_blocks",
			arguments: {
				workspaceId: f.workspaceId,
				pageId: created.pageId,
				expectedRevision: body.revision,
				operations: [
					{
						op: "update_table_cell",
						blockId: body.blocks[0]!.id,
						row: 1,
						column: 1,
						content: text("Shipped"),
					},
				],
			},
		});
		expect(result.result.isError).not.toBe(true);
		expect(
			await f.execute("read_page", { pageId: created.pageId }),
		).toMatchObject({
			markdown: "| Option | Status |\n| --- | --- |\n| One | Shipped |",
		});
	} finally {
		await f.database.close();
	}
});

test("Agent Auth table deletion requires a replacement grant for the same page", async () => {
	const f = await fixture();
	try {
		f.ctx.ports.agents = createTestAgentAdminRepository();
		const executor = await createHaunterAgentCapabilityExecutor({
			getServer: async () => f.server,
		});
		const { onExecute } = createHaunterAgentAuthAdapter(executor);
		if (!onExecute) throw new Error("Missing Agent Auth executor");
		for (const op of ["delete_table_row", "delete_table_column"]) {
			const before = await f.read();
			const run = (pageId: string, status = "active") => {
				const context = createBetterAuthAgentCapabilityTestContext({
					capability: "edit_page_blocks",
					userId: f.userId,
					constraints: { workspaceId: f.workspaceId },
					arguments: {
						workspaceId: f.workspaceId,
						pageId: f.page.id,
						expectedRevision: before.revision,
						operations: [{ op, blockId: "table", index: 1 }],
					},
				});
				context.agentSession.agent.capabilityGrants.push({
					capability: "replace_page_content",
					status,
					constraints: { workspaceId: f.workspaceId, pageId },
					grantedBy: f.userId,
				});
				return onExecute(context);
			};
			await expect(run(crypto.randomUUID())).rejects.toMatchObject({
				body: { error: "FORBIDDEN" },
			});
			await expect(run(f.page.id, "revoked")).rejects.toMatchObject({
				body: { error: "FORBIDDEN" },
			});
			expect(await f.read()).toEqual(before);
			await run(f.page.id);
		}
		expect(
			EditableTableContentSchema.parse((await f.read()).blocks[1]!.content)
				.rows,
		).toHaveLength(1);
	} finally {
		await f.database.close();
	}
});

test("replacement preserves unsupported merged tables, while targeted edits reject them", async () => {
	const f = await fixture();
	try {
		await seedFixtureBody(f, [
			paragraph("Keep", "intro"),
			{
				id: "merged",
				type: "table",
				props: {},
				children: [],
				content: {
					type: "tableContent",
					rows: [
						{
							cells: [
								{
									type: "tableCell",
									props: { colspan: 2 },
									content: text("Merged"),
								},
							],
						},
						{ cells: [text("Left"), text("Right")] },
					],
				},
			},
		]);
		const before = await f.read();
		await expect(
			f.edit([
				{
					op: "update_table_cell",
					blockId: "merged",
					row: 1,
					column: 0,
					content: text("Change"),
				},
			]),
		).rejects.toMatchObject({ code: "INVALID_PAGE_CONTENT" });
		expect(await f.read()).toEqual(before);
		await f.execute("replace_page_content", {
			expectedRevision: before.revision,
			content: {
				format: "blocks",
				blocks: JSON.parse(
					JSON.stringify([paragraph("Rewritten", "intro"), before.blocks[1]]),
				),
			},
		});
		expect((await f.read()).blocks[1]).toEqual(before.blocks[1]);
		await f.execute("replace_page_content", {
			expectedRevision: (await f.read()).revision,
			content: {
				format: "markdown",
				markdown: "| A | B |\n| --- | --- |\n| Left | Right |",
			},
		});
		const replacement = await f.read();
		expect(replacement.blocks[0]!.type).toBe("table");
		await f.edit([
			{
				op: "update_table_cell",
				blockId: replacement.blocks[0]!.id,
				row: 1,
				column: 1,
				content: text("Changed"),
			},
		]);
	} finally {
		await f.database.close();
	}
});

test("table creation and growth enforce bounded dimensions without changing the page", async () => {
	const f = await fixture();
	try {
		const before = await f.read();
		for (const content of [
			{ type: "tableContent", rows: [{ cells: [] }] },
			{
				type: "tableContent",
				rows: [{ cells: Array.from({ length: 51 }, () => []) }],
			},
			{
				type: "tableContent",
				rows: Array.from({ length: 201 }, () => ({ cells: [[]] })),
			},
			{ ...table().content, columnWidths: [100] },
		])
			await expect(
				f.edit([
					{
						op: "insert",
						afterBlockId: null,
						blocks: [{ type: "table", content }],
					},
				]),
			).rejects.toThrow();
		await expect(
			f.execute("append_to_page", {
				markdown: `| Header |\n| --- |\n${"| Row |\n".repeat(200)}`,
			}),
		).rejects.toMatchObject({ code: "INVALID_PAGE_CONTENT" });
		expect(await f.read()).toEqual(before);
		await seedFixtureBody(f, [
			{
				id: "wide",
				type: "table",
				props: {},
				children: [],
				content: {
					type: "tableContent",
					rows: [{ cells: Array.from({ length: 50 }, () => []) }],
				},
			},
		]);
		const wide = await f.read();
		await expect(
			f.edit([
				{ op: "insert_table_column", blockId: "wide", index: 50, cells: [[]] },
			]),
		).rejects.toMatchObject({ code: "INVALID_PAGE_CONTENT" });
		expect(await f.read()).toEqual(wide);
	} finally {
		await f.database.close();
	}
});
