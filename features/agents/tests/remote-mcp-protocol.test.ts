import { describe, expect, test } from "bun:test";
import {
	CLIENT_CAPABILITIES_META_KEY,
	CLIENT_INFO_META_KEY,
	PROTOCOL_VERSION_META_KEY,
} from "@modelcontextprotocol/server";
import type { McpConnectionRow } from "@/features/agents/ports";
import { mcpCorsHeaders } from "@/lib/mcp-http";
import { createRemoteMcpRequestHandler } from "@/server/remote-mcp";

const connection: McpConnectionRow = {
	id: "connection_test",
	userId: "user_test",
	clientId: "client_test",
	clientName: "Test client",
	permissionProfile: "view",
	status: "active",
	workspaceIds: ["workspace_test"],
	lastUsedAt: null,
	createdAt: new Date("2026-08-06T00:00:00.000Z"),
	updatedAt: new Date("2026-08-06T00:00:00.000Z"),
};

function createHandler(
	profile: McpConnectionRow["permissionProfile"] = "view",
) {
	return createRemoteMcpRequestHandler({
		connection: { ...connection, permissionProfile: profile },
		identity: { userId: connection.userId, clientId: connection.clientId },
		getServer: async () => {
			throw new Error(
				"Tool execution is not expected in protocol discovery tests.",
			);
		},
	});
}

function modernRequest(method: string, params: Record<string, unknown> = {}) {
	const meta = {
		[PROTOCOL_VERSION_META_KEY]: "2026-07-28",
		[CLIENT_INFO_META_KEY]: { name: "Haunter tests", version: "1.0.0" },
		[CLIENT_CAPABILITIES_META_KEY]: {},
	};
	const headers = new Headers({
		Accept: "application/json",
		"Content-Type": "application/json",
		"Mcp-Method": method,
		"Mcp-Protocol-Version": "2026-07-28",
	});
	if (typeof params.name === "string") {
		headers.set("Mcp-Name", params.name);
	}
	return new Request("https://haunter.test/mcp", {
		method: "POST",
		headers,
		body: JSON.stringify({
			jsonrpc: "2.0",
			id: crypto.randomUUID(),
			method,
			params: { _meta: meta, ...params },
		}),
	});
}

function legacyRequest(
	id: number,
	method: string,
	params: Record<string, unknown>,
) {
	return new Request("https://haunter.test/mcp", {
		method: "POST",
		headers: {
			Accept: "application/json, text/event-stream",
			"Content-Type": "application/json",
			"Mcp-Protocol-Version": "2025-06-18",
		},
		body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
	});
}

test("content management discovery respects profiles and declares write semantics", async () => {
	const readers = [
		"list_canvases",
		"list_canvas_favorites",
		"list_page_favorites",
		"list_backlinks",
		"list_trash",
		"list_page_versions",
		"read_page_version",
	];
	const editors = [
		"create_canvas",
		"update_canvas",
		"set_canvas_favorite",
		"set_page_favorite",
	];
	const destructive = ["delete_canvas", "restore_page_version"];
	for (const profile of ["view", "edit", "full"] as const) {
		const body = await json(
			await createHandler(profile)(modernRequest("tools/list")),
		);
		const tools = body.result?.tools as Array<{
			name: string;
			annotations: Record<string, boolean>;
			inputSchema: { required: string[] };
			_meta?: { ui?: { visibility?: string[] } };
		}>;
		for (const name of readers) {
			const tool = tools.find((t) => t.name === name);
			expect(tool?.annotations).toMatchObject({
				readOnlyHint: true,
				destructiveHint: false,
				idempotentHint: true,
			});
			expect(tool?._meta?.ui?.visibility).not.toEqual(["app"]);
			expect(tool?.inputSchema.required).toContain("workspaceId");
		}
		for (const name of editors) {
			const tool = tools.find((t) => t.name === name);
			if (profile === "view") expect(tool).toBeUndefined();
			else
				expect(tool?.annotations).toMatchObject({
					readOnlyHint: false,
					destructiveHint: false,
					idempotentHint: name !== "create_canvas",
				});
		}
		for (const name of destructive) {
			const tool = tools.find((t) => t.name === name);
			if (profile !== "full") expect(tool).toBeUndefined();
			else {
				expect(tool?.annotations).toMatchObject({
					readOnlyHint: false,
					destructiveHint: true,
				});
				if (name === "restore_page_version")
					expect(tool?.inputSchema.required).toEqual(
						expect.arrayContaining([
							"workspaceId",
							"pageId",
							"versionId",
							"expectedRevision",
						]),
					);
			}
		}
		for (const name of [
			"purge_page",
			"purge_trash",
			"delete_workspace",
			"delete_account",
		])
			expect(tools.some((t) => t.name === name)).toBe(false);
	}
});

async function json(response: Response) {
	return (await response.json()) as {
		result?: Record<string, unknown>;
		error?: { code: number; message: string };
	};
}

async function legacyJson(response: Response) {
	const body = await response.text();
	const data = body
		.split("\n")
		.find((line) => line.startsWith("data: "))
		?.slice("data: ".length);
	if (!data) throw new Error(`Expected an SSE data event, received: ${body}`);
	return JSON.parse(data) as {
		result?: Record<string, unknown>;
		error?: { code: number; message: string };
	};
}

describe("remote MCP protocol", () => {
	test("serves native MCP v2 discovery", async () => {
		const response = await createHandler()(modernRequest("server/discover"));
		const body = await json(response);

		expect(response.status).toBe(200);
		expect(body.error).toBeUndefined();
		expect(body.result?.supportedVersions).toContain("2026-07-28");
		expect(body.result?.capabilities).toMatchObject({ tools: {} });
		expect(body.result?._meta).toMatchObject({
			"io.modelcontextprotocol/serverInfo": {
				name: "haunter",
				version: "1.0.0",
			},
		});
	});

	test("exposes only profile-authorized tools to native MCP v2 clients", async () => {
		const response = await createHandler()(modernRequest("tools/list"));
		const body = await json(response);
		const tools = body.result?.tools as Array<{ name: string }>;
		const names = tools.map((tool) => tool.name);

		expect(response.status).toBe(200);
		expect(names).toContain("read_page");
		expect(names).toContain("search_canvas_library");
		expect(names).not.toContain("insert_canvas_library_item");
		expect(names).toContain("list_tasks");
		expect(names).not.toContain("update_page");
		expect(names).not.toContain("delete_task");
	});

	test("workspace controls are app-only and mutations are not labelled read-only", async () => {
		const body = await json(await createHandler()(modernRequest("tools/list")));
		const tools = body.result?.tools as Array<{
			name: string;
			_meta: unknown;
			annotations: unknown;
		}>;
		for (const name of ["get_haunter_workspace", "act_in_haunter_workspace"])
			expect(tools.find((tool) => tool.name === name)?._meta).toMatchObject({
				ui: { visibility: ["app"] },
			});
		expect(
			tools.find((tool) => tool.name === "act_in_haunter_workspace")
				?.annotations,
		).toMatchObject({ readOnlyHint: false, destructiveHint: true });
	});

	test("validates registered tool input through the native MCP v2 call path", async () => {
		const response = await createHandler()(
			modernRequest("tools/call", {
				name: "read_page",
				arguments: {},
			}),
		);
		const body = await json(response);
		const content = body.result?.content as Array<{
			type: string;
			text: string;
		}>;

		expect(response.status).toBe(200);
		expect(body.result?.isError).toBeTrue();
		expect(content[0]?.text).toContain("Input validation error");
		expect(content[0]?.text).toContain("workspaceId");
	});

	test("keeps the stateless 2025 protocol fallback working", async () => {
		const handler = createHandler();
		const initializeResponse = await handler(
			legacyRequest(1, "initialize", {
				protocolVersion: "2025-06-18",
				capabilities: {},
				clientInfo: { name: "Legacy test client", version: "1.0.0" },
			}),
		);
		const initialized = await legacyJson(initializeResponse);
		const listResponse = await handler(legacyRequest(2, "tools/list", {}));
		const listed = await legacyJson(listResponse);
		const tools = listed.result?.tools as Array<{ name: string }>;

		expect(initializeResponse.status).toBe(200);
		expect(initialized.result?.protocolVersion).toBe("2025-06-18");
		expect(tools.map((tool) => tool.name)).toContain("read_page");
		expect(tools.map((tool) => tool.name)).not.toContain("update_page");
	});

	test("rejects removed session-oriented transports", async () => {
		const response = await createHandler()(
			new Request("https://haunter.test/mcp", { method: "GET" }),
		);

		expect(response.status).toBe(405);
	});

	test("allows the native protocol headers through browser preflight", () => {
		const headers = mcpCorsHeaders(
			new Request("https://haunter.test/mcp", { method: "OPTIONS" }),
		);
		const allowed = headers.get("Access-Control-Allow-Headers");

		expect(allowed).toContain("Mcp-Method");
		expect(allowed).toContain("Mcp-Name");
		expect(allowed).toContain("Mcp-Protocol-Version");
	});
});

test("MCP advertises library search as read-only and insertion only for editors", async () => {
	const body = await json(
		await createHandler("edit")(modernRequest("tools/list")),
	);
	const tools = body.result?.tools as Array<{
		name: string;
		annotations: Record<string, unknown>;
		inputSchema: { required: string[] };
	}>;
	expect(
		tools.find((tool) => tool.name === "search_canvas_library")?.annotations,
	).toMatchObject({ readOnlyHint: true, idempotentHint: true });
	const insert = tools.find(
		(tool) => tool.name === "insert_canvas_library_item",
	);
	expect(insert?.annotations).toMatchObject({
		readOnlyHint: false,
		idempotentHint: false,
		destructiveHint: false,
	});
	expect(insert?.inputSchema.required).toEqual(
		expect.arrayContaining([
			"workspaceId",
			"canvasId",
			"itemId",
			"itemVersion",
			"expectedRevision",
			"x",
			"y",
		]),
	);
});
