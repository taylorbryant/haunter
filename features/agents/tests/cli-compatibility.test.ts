import { expect, test } from "bun:test";
import {
	cliFixture,
	verifyFriendlyCommands,
	verifyExtendedCommands,
	verifyViewOnlyMutations,
	verifyToolDiscovery,
} from "./cli-fixture";
import { cliBaselines } from "./cli-baselines";
import { contractChanges } from "./cli-contract";
import baseline from "./fixtures/cli-contract-0.1.0.json";

for (const released of cliBaselines) {
	test(`MCP contracts remain compatible with the immutable haunter ${released.release.version} baseline`, async () => {
		const f = await cliFixture();
		try {
			expect(contractChanges(released.tools, await f.tools())).toEqual([]);
		} finally {
			await f.close();
		}
	});
}

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

test("the compatibility guard permits optional fields in read_page's recursive block definition", () => {
	const current = structuredClone(baseline.tools);
	const readPage = current.find((tool) => tool.name === "read_page");
	if (!readPage?.outputSchema?.$defs)
		throw new Error("Missing read_page definitions in the released baseline");
	const block = readPage.outputSchema.$defs.__schema0;
	Object.assign(block.properties, { extra: { type: "string" } });
	expect(contractChanges(baseline.tools, current)).toEqual([]);
});

test.each(["input", "output"] as const)(
	"the compatibility guard checks %s definitions recursively without weakening breaking-change detection",
	(direction) => {
		const item = {
			type: "object",
			properties: { id: { type: "string" } },
			required: ["id"],
		};
		const schema = {
			type: "object",
			properties: { item: { $ref: "#/$defs/item" } },
			$defs: { item },
		};
		const tool = (candidate: Record<string, unknown>) => ({
			name: "example",
			inputSchema: direction === "input" ? candidate : {},
			outputSchema: direction === "output" ? candidate : {},
		});
		const original = [tool(schema)];
		const additive = {
			...schema,
			$defs: {
				item: {
					...item,
					description: "Updated documentation",
					properties: { ...item.properties, extra: { type: "string" } },
				},
				extra: { type: "string" },
			},
		};
		expect(contractChanges(original, [tool(additive)])).toEqual([]);
		expect(contractChanges([tool({})], [tool({ $defs: { item } })])).toEqual(
			[],
		);
		for (const candidate of [
			{ ...schema, $defs: {} },
			{ ...schema, $defs: undefined },
			{ ...schema, $defs: { item: false } },
			{ ...schema, $defs: { item: { ...item, default: {} } } },
			{ ...schema, $defs: { item: { ...item, properties: {} } } },
			{
				...schema,
				$defs: {
					item: {
						...item,
						properties: { id: { type: "number" } },
					},
				},
			},
			{
				...schema,
				$defs: {
					item: {
						...item,
						properties: { id: { type: "string", minLength: 1 } },
					},
				},
			},
			{
				...schema,
				$defs: {
					item: {
						...item,
						required: direction === "input" ? ["id", "extra"] : [],
					},
				},
			},
			{ ...schema, properties: { item: { $ref: "#/$defs/other" } } },
		])
			expect(
				contractChanges(original, [tool(candidate)]).length,
			).toBeGreaterThan(0);
	},
);

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
	try {
		await verifyExtendedCommands(f.run, f);
	} finally {
		await f.close();
	}
}, 30_000);

test("new friendly mutations respect view-only connection permissions", async () => {
	const f = await cliFixture("view");
	try {
		await verifyViewOnlyMutations(f.run, f.page);
	} finally {
		await f.close();
	}
}, 30_000);

test("generic CLI discovery, validation, and calls use the real permission-scoped MCP contracts", async () => {
	const f = await cliFixture("view");
	try {
		await verifyToolDiscovery(f.run, f.page.id);
	} finally {
		await f.close();
	}
}, 30_000);
