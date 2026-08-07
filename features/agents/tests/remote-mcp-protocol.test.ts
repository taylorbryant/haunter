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

function createHandler() {
	return createRemoteMcpRequestHandler({
		connection,
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
		expect(names).toContain("list_tasks");
		expect(names).not.toContain("update_page");
		expect(names).not.toContain("delete_task");
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
