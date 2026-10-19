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
