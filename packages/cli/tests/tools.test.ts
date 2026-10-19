import { expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { fixture } from "./helpers";

const tool: Tool = {
	name: "future_tool",
	description: "A newly deployed tool",
	inputSchema: {
		$schema: "https://json-schema.org/draft/2020-12/schema",
		type: "object",
		properties: {
			workspaceId: { type: "string" },
			count: { type: "integer", minimum: 1 },
		},
		required: ["workspaceId", "count"],
		additionalProperties: false,
	},
	outputSchema: {
		type: "object",
		properties: { ok: { type: "boolean" } },
		required: ["ok"],
	},
};
const result = {
	content: [
		{ type: "text" as const, text: "Created" },
		{ type: "image" as const, mimeType: "image/png", data: "aGVsbG8=" },
		{
			type: "resource_link" as const,
			uri: "https://haunter.test/page",
			name: "Page",
		},
	],
	structuredContent: { ok: true },
	_meta: { extra: "preserved" },
};

test("discovers paginated tools after refresh and calls a new tool without a command mapping", async () => {
	const f = await fixture();
	try {
		await f.signIn();
		f.expire();
		f.setToolPages([{ tools: [], nextCursor: "second" }, { tools: [tool] }]);
		f.setToolResult(tool.name, result);
		const listed = await f.run(["tools", "list", "--json"]);
		expect(listed.code).toBe(0);
		expect(JSON.parse(listed.stdout).tools).toEqual([tool]);
		expect(f.listCursors).toEqual([undefined, "second"]);
		expect(f.refreshes).toBe(1);
		const described = await f.run(["tools", "describe", tool.name, "--json"]);
		expect(JSON.parse(described.stdout)).toEqual(tool);
		const called = await f.run(
			["tools", "call", tool.name, "--input", "-", "--json"],
			'{"count":2}',
		);
		expect(called).toMatchObject({ code: 0, stderr: "" });
		expect(JSON.parse(called.stdout)).toEqual(result);
		expect(f.calls.at(-1)).toEqual({
			name: tool.name,
			arguments: { count: 2, workspaceId: "workspace-1" },
		});
	} finally {
		await f.close();
	}
});

test("rejects invalid arguments, unknown tools, and malformed JSON before calling tools", async () => {
	const f = await fixture();
	try {
		await f.signIn();
		f.setToolPages([{ tools: [tool] }]);
		for (const input of [
			'{"count":"2"}',
			'{"count":0}',
			'{"count":2,"extra":1}',
			"{}",
			"[]",
			"null",
			"{broken",
			" ".repeat(1_000_001),
		]) {
			const called = await f.run(
				[
					"tools",
					"call",
					tool.name,
					"--workspace",
					"w",
					"--input",
					"-",
					"--json",
				],
				input,
			);
			expect(called.code).toBe(1);
			expect(called.stdout).toBe("");
		}
		expect(f.calls).toEqual([]);
		expect((await f.run(["tools", "call", "unknown"])).stderr).toContain(
			"not available",
		);
		f.setToolPages([
			{ tools: [{ ...tool, execution: { taskSupport: "required" } }] },
		]);
		expect((await f.run(["tools", "call", tool.name])).stderr).toContain(
			"requires MCP task support",
		);
		expect(f.calls).toEqual([]);
	} finally {
		await f.close();
	}
});

test("honors explicit JSON workspace, fills defaults only for scoped tools, and reads files", async () => {
	const f = await fixture();
	try {
		await f.signIn();
		f.setToolPages([{ tools: [tool] }]);
		f.setToolResult(tool.name, result);
		const file = join(f.directory, "input.json");
		await writeFile(file, '{"count":1,"workspaceId":"explicit"}');
		expect(
			(
				await f.run(["tools", "call", tool.name, "--input", file], "", {
					HAUNTER_WORKSPACE: "default",
				})
			).code,
		).toBe(0);
		expect(f.calls.at(-1)?.arguments.workspaceId).toBe("explicit");
		const calls = f.calls.length;
		expect(
			(
				await f.run([
					"tools",
					"call",
					tool.name,
					"--input",
					file,
					"-w",
					"conflict",
				])
			).stderr,
		).toContain("conflicts");
		expect(f.calls).toHaveLength(calls);
		for (const [args, env, expected] of [
			[["-w", "flag"], { HAUNTER_WORKSPACE: "environment" }, "flag"],
			[[], { HAUNTER_WORKSPACE: "environment" }, "environment"],
			[[], {}, "workspace-1"],
		] as const) {
			expect(
				(
					await f.run(
						["tools", "call", tool.name, "--input", "-", ...args],
						'{"count":1}',
						env,
					)
				).code,
			).toBe(0);
			expect(f.calls.at(-1)?.arguments.workspaceId).toBe(expected);
		}
		f.setToolPages([
			{
				tools: [
					{
						name: "unscoped",
						inputSchema: { type: "object", additionalProperties: false },
					},
				],
			},
		]);
		f.setToolResult("unscoped", { content: [] });
		f.setWorkspaces([]);
		expect(
			(
				await f.run(["tools", "call", "unscoped"], "", {
					HAUNTER_WORKSPACE: "ignored",
				})
			).code,
		).toBe(0);
		expect(f.calls.at(-1)).toEqual({ name: "unscoped", arguments: {} });
		expect(
			(await f.run(["tools", "call", "unscoped", "-w", "ignored"])).stderr,
		).toContain("does not accept");
	} finally {
		await f.close();
	}
});

test("reports tool errors and invalid outputs without losing responses or retrying writes", async () => {
	const f = await fixture();
	try {
		await f.signIn();
		f.setToolPages([{ tools: [tool] }]);
		for (const response of [
			{ ...result, isError: true },
			{ ...result, structuredContent: { ok: "invalid" } },
		]) {
			f.setToolResult(tool.name, response);
			const called = await f.run(
				["tools", "call", tool.name, "--input", "-", "-w", "w", "--json"],
				'{"count":1}',
			);
			expect(called.code).toBe(1);
			expect(JSON.parse(called.stdout)).toEqual(response);
			expect(JSON.parse(called.stderr).error).toBeString();
		}
		expect(f.calls).toHaveLength(2);
	} finally {
		await f.close();
	}
});

test("omits app-only tools and fails on repeating cursors or duplicate names", async () => {
	const f = await fixture();
	try {
		await f.signIn();
		f.setToolPages([
			{ tools: [{ ...tool, _meta: { ui: { visibility: ["app"] } } }] },
		]);
		expect(
			JSON.parse((await f.run(["tools", "list", "--json"])).stdout).tools,
		).toEqual([]);
		expect((await f.run(["tools", "call", tool.name])).code).toBe(1);
		f.setToolPages([
			{ tools: [], nextCursor: "loop" },
			{ tools: [], nextCursor: "loop" },
		]);
		expect((await f.run(["tools", "list"])).stderr).toContain("repeated");
		f.setToolPages([{ tools: [tool], nextCursor: "more" }, { tools: [tool] }]);
		expect((await f.run(["tools", "list"])).stderr).toContain("duplicate");
		expect(f.calls).toEqual([]);
	} finally {
		await f.close();
	}
});
