import { expect, test } from "bun:test";
import { cliFixture, verifyFriendlyCommands } from "./cli-fixture";
import { contractChanges } from "./cli-contract";
import baseline from "./fixtures/cli-contract-0.1.0.json";

test("MCP contracts remain compatible with the immutable haunter 0.1.0 baseline", async () => {
	const f = await cliFixture();
	try {
		expect(contractChanges(baseline.tools, await f.tools())).toEqual([]);
	} finally {
		await f.close();
	}
});

test("the compatibility guard permits additions but catches breaking input and output changes", () => {
	const schema = {
		type: "object",
		properties: { id: { type: "string" } },
		required: ["id"],
	};
	const original = [
		{ name: "example", inputSchema: schema, outputSchema: schema },
	];
	const extra = { type: "string" };
	expect(
		contractChanges(original, [
			{ name: "new_tool", inputSchema: {} },
			{
				name: "example",
				inputSchema: {
					...schema,
					description: "new docs",
					properties: { ...schema.properties, extra },
				},
				outputSchema: {
					...schema,
					properties: { ...schema.properties, extra },
					required: ["id", "extra"],
				},
			},
		]),
	).toEqual([]);
	for (const candidate of [
		[],
		[{ ...original[0], inputSchema: { ...schema, required: ["id", "extra"] } }],
		[{ ...original[0], outputSchema: { ...schema, required: [] } }],
		[{ ...original[0], outputSchema: { ...schema, properties: {} } }],
		[
			{
				...original[0],
				inputSchema: { ...schema, properties: { id: { type: "number" } } },
			},
		],
		[
			{
				...original[0],
				inputSchema: {
					...schema,
					properties: { id: { type: "string", minLength: 1 } },
				},
			},
		],
	])
		expect(contractChanges(original, candidate).length).toBeGreaterThan(0);
});

test("the current CLI's friendly commands work through the real MCP handler", async () => {
	const f = await cliFixture();
	try {
		await verifyFriendlyCommands(f.run, f.workspaceId);
	} finally {
		await f.close();
	}
}, 30_000);

test("new friendly commands search real content and preserve page/task data when updating", async () => {
	const f = await cliFixture();
	async function json(args: string[], input?: string) {
		const result = await f.run([...args, "--json"], input);
		expect(result.stderr).toBe("");
		expect(result.code).toBe(0);
		return JSON.parse(result.stdout);
	}
	try {
		const page = await json([
			"capture",
			"Original body",
			"--title",
			"CLI notes",
		]);
		const renamed = await json([
			"pages",
			"rename",
			page.pageId,
			"CLI renamed notes",
		]);
		expect(renamed).toMatchObject({
			pageId: page.pageId,
			title: "CLI renamed notes",
			parentPageId: null,
		});
		expect((await json(["pages", "read", page.pageId])).markdown).toContain(
			"Original body",
		);
		const canvas = await f.database.repositories.canvases.create(f.scope, {
			userId: f.userId,
			pageId: null,
			title: "CLI drawing",
		});
		const inline = await f.database.repositories.canvases.create(f.scope, {
			userId: f.userId,
			pageId: page.pageId,
			title: "Inline drawing",
		});
		const canvases = await json(["canvases", "list"]);
		expect(canvases.canvases).toContainEqual(
			expect.objectContaining({ canvasId: canvas.id, title: "CLI drawing" }),
		);
		expect(
			canvases.canvases.some(
				(item: { canvasId: string }) => item.canvasId === inline.id,
			),
		).toBe(false);
		const created = await json(
			["tools", "call", "create_task", "--input", "-"],
			JSON.stringify({
				title: "CLI task",
				dueDate: "2026-12-12",
				dueTime: "09:30",
				reminderOffsetMinutes: 15,
			}),
		);
		const taskId = created.structuredContent.taskId;
		const updated = await json([
			"tasks",
			"update",
			taskId,
			"--title",
			"CLI renamed task",
			"--due",
			"2026-12-13",
		]);
		expect(updated).toMatchObject({
			title: "CLI renamed task",
			dueDate: "2026-12-13",
			dueTime: "09:30",
			reminderOffsetMinutes: 15,
			completed: false,
		});
		await json(["tasks", "done", taskId]);
		expect(await json(["tasks", "reopen", taskId])).toMatchObject({
			taskId,
			completed: false,
			completedAt: null,
		});
		expect(
			await json(["tasks", "update", taskId, "--clear-due"]),
		).toMatchObject({
			title: "CLI renamed task",
			dueDate: null,
			dueTime: null,
			reminderOffsetMinutes: null,
		});
		const items: { kind: string; id: string }[] = [];
		let cursor: string | null = null;
		for (let count = 0; count < 10; count++) {
			const result = await json([
				"search",
				"CLI",
				"--limit",
				"1",
				...(cursor ? ["--cursor", cursor] : []),
			]);
			items.push(...result.items);
			cursor = result.nextCursor;
			if (cursor === null) break;
		}
		expect(cursor).toBeNull();
		expect(items).toHaveLength(3);
		expect(items).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ kind: "page", id: page.pageId }),
				expect.objectContaining({ kind: "task", id: taskId }),
				expect.objectContaining({ kind: "canvas", id: canvas.id }),
			]),
		);
		const filtered = await json(["search", "CLI", "--kind", "canvas"]);
		expect(filtered.items).toHaveLength(1);
		expect(filtered.items[0].id).toBe(canvas.id);
	} finally {
		await f.close();
	}
}, 30_000);

test("new friendly mutations respect view-only connection permissions", async () => {
	const f = await cliFixture("view");
	try {
		for (const args of [
			["pages", "rename", f.page.id, "Forbidden rename"],
			["tasks", "update", crypto.randomUUID(), "--clear-due"],
			["tasks", "reopen", crypto.randomUUID()],
		]) {
			const denied = await f.run([...args, "--json"]);
			expect(denied.code).toBe(1);
			expect(denied.stdout).toBe("");
		}
		const read = await f.run(["pages", "read", f.page.id, "--json"]);
		expect(JSON.parse(read.stdout).title).toBe(f.page.title);
	} finally {
		await f.close();
	}
}, 30_000);

test("generic CLI discovery, validation, and calls use the real permission-scoped MCP contracts", async () => {
	const f = await cliFixture("view");
	try {
		const listed = await f.run(["tools", "list", "--json"]);
		expect(listed.code).toBe(0);
		const tools = JSON.parse(listed.stdout).tools as { name: string }[];
		expect(tools.some((tool) => tool.name === "read_page")).toBe(true);
		expect(tools.some((tool) => tool.name === "create_page")).toBe(false);
		expect(tools.some((tool) => tool.name === "authorize_haunter_editor")).toBe(
			false,
		);
		const called = await f.run(["tools", "call", "list_pages", "--json"]);
		expect(called.code).toBe(0);
		expect(JSON.parse(called.stdout).structuredContent.pages).toContainEqual(
			expect.objectContaining({ pageId: f.page.id }),
		);
		const invalid = await f.run(
			["tools", "call", "read_page", "--input", "-", "--json"],
			'{"pageId":"not-a-uuid"}',
		);
		expect(invalid.code).toBe(1);
		expect(JSON.parse(invalid.stderr).error).toContain("Invalid arguments");
		const denied = await f.run(["tools", "call", "create_page", "--json"]);
		expect(denied.code).toBe(1);
		expect(JSON.parse(denied.stderr).error).toContain("not available");
	} finally {
		await f.close();
	}
}, 30_000);
