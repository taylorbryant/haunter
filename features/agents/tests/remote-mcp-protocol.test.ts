import { describe, expect, test } from "bun:test";
import {
	CLIENT_CAPABILITIES_META_KEY,
	CLIENT_INFO_META_KEY,
	PROTOCOL_VERSION_META_KEY,
} from "@modelcontextprotocol/server";
import type { McpConnectionRow } from "@/features/agents/ports";
import { env } from "@/lib/env";
import { mcpCorsHeaders } from "@/lib/mcp-http";
import { createRemoteMcpRequestHandler } from "@/server/remote-mcp";
import { APP_THEMES } from "@/lib/themes";

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

test("hosted MCP searches saved workspace content and rejects revoked membership", async () => {
	const { embeddedEditorFixture } = await import("./embedded-editor-fixture");
	const { eq } = await import("drizzle-orm");
	const schema = await import("@/infra/db/schema");
	const f = await embeddedEditorFixture("view", "view");
	try {
		const handler = createRemoteMcpRequestHandler({
			connection: f.connection,
			identity: { userId: f.userId, clientId: "embedded-client" },
			getServer: async () => ({
				ports: f.ctx.ports,
				createServiceContext: async () => f.ctx,
			}),
		});
		const request = (workspaceId: string) =>
			modernRequest("tools/call", {
				name: "search_workspace",
				arguments: { workspaceId, query: "Document" },
			});
		const result = await json(await handler(request(f.workspaceId)));
		expect(result.error).toBeUndefined();
		expect(result.result?.isError).not.toBeTrue();
		expect(result.result?.structuredContent).toMatchObject({
			items: [expect.objectContaining({ kind: "page", id: f.page.id })],
			nextCursor: null,
		});
		const foreign = await json(await handler(request("other")));
		expect(foreign.result?.isError).toBeTrue();
		expect(foreign.result?.structuredContent).toBeUndefined();
		await f.database.db
			.delete(schema.member)
			.where(eq(schema.member.userId, f.userId));
		const revoked = await json(await handler(request(f.workspaceId)));
		expect(revoked.result?.isError).toBeTrue();
		expect(revoked.result?.structuredContent).toBeUndefined();
	} finally {
		await f.database.close();
	}
});

test("content management discovery respects profiles and declares write semantics", async () => {
	const readers = [
		"search_workspace",
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
	const destructive = [
		"delete_canvas",
		"restore_page_version",
		"restore_canvas_version",
	];
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
				if (name === "restore_canvas_version") {
					expect(tool?.annotations.idempotentHint).toBe(false);
					expect(tool?.inputSchema.required).toEqual(
						expect.arrayContaining([
							"workspaceId",
							"canvasId",
							"historyVersionId",
							"expectedRevision",
						]),
					);
				}
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
	test("advertises native settings on both protocol versions", async () => {
		const capability = {
			readTool: "read_haunter_settings",
			updateTool: "update_haunter_settings",
		};
		const modern = await json(
			await createHandler()(modernRequest("server/discover")),
		);
		expect(modern.result?.capabilities).toMatchObject({
			extensions: { "openai/settings": capability },
		});
		const legacy = await legacyJson(
			await createHandler()(
				legacyRequest(1, "initialize", {
					protocolVersion: "2025-06-18",
					capabilities: {},
					clientInfo: { name: "Settings test", version: "1" },
				}),
			),
		);
		expect(legacy.result?.capabilities).toMatchObject({
			experimental: { "openai/settings": capability },
		});
		const listed = await json(
			await createHandler()(modernRequest("tools/list")),
		);
		const tools = listed.result?.tools as Array<{ name: string }>;
		for (const name of [capability.readTool, capability.updateTool]) {
			expect(tools.find((tool) => tool.name === name)).toMatchObject({
				annotations: {
					readOnlyHint: name === capability.readTool,
					destructiveHint: false,
					idempotentHint: true,
					openWorldHint: false,
				},
				_meta: { ui: { visibility: ["app"] } },
			});
		}
	});

	test.each(["view", "edit"] as const)(
		"%s connections can save personal settings, but cannot change another user's settings or use a revoked connection",
		async (access) => {
			const { embeddedEditorFixture } = await import(
				"./embedded-editor-fixture"
			);
			const f = await embeddedEditorFixture(access, access);
			try {
				const handler = createRemoteMcpRequestHandler({
					connection: f.connection,
					identity: { userId: f.userId, clientId: f.connection.clientId },
					getServer: async () => ({
						ports: f.ctx.ports,
						createServiceContext: async () => f.ctx,
					}),
				});
				const call = async (name: string, args: Record<string, unknown> = {}) =>
					json(
						await handler(
							modernRequest("tools/call", { name, arguments: args }),
						),
					);
				const read = await call("read_haunter_settings");
				expect(read.result?.structuredContent).toMatchObject({
					schema: {
						properties: {
							theme: {
								title: "Theme",
								type: "string",
								enum: [
									"Follow host",
									...APP_THEMES.map((theme) => theme.label),
								],
							},
						},
					},
					values: { theme: "Follow host" },
					layout: [
						{
							kind: "group",
							title: "Appearance",
							items: [{ kind: "property", property: "theme" }],
						},
					],
				});
				await f.ctx.ports.embeddedAppearance.set(f.userId, {
					theme: "rose-pine",
				});
				expect(
					(await call("read_haunter_settings")).result?.structuredContent,
				).toMatchObject({ values: { theme: "Rosé Pine" } });
				for (const theme of [
					"Follow host",
					...APP_THEMES.map((theme) => theme.label),
				]) {
					const saved = await call("update_haunter_settings", {
						set: { theme },
					});
					expect(saved.result?.isError).not.toBeTrue();
					expect(saved.result?.structuredContent).toEqual({
						values: { theme },
					});
				}
				await call("update_haunter_settings", { set: { theme: "Dracula" } });
				expect(await f.ctx.ports.embeddedAppearance.get(f.userId)).toEqual({
					theme: "dracula",
				});
				for (const args of [
					{ set: {} },
					{ set: { theme: "unknown" } },
					{ set: { theme: "Dark", userId: "another-user" } },
					{ set: { theme: "Dark" }, userId: "another-user" },
				]) {
					const invalid = await call("update_haunter_settings", args);
					expect(Boolean(invalid.error || invalid.result?.isError)).toBeTrue();
				}
				expect(await f.ctx.ports.embeddedAppearance.get(f.userId)).toEqual({
					theme: "dracula",
				});
				expect(
					await f.ctx.ports.embeddedAppearance.get("another-user"),
				).toEqual({ theme: "host" });
				await f.ctx.ports.mcpConnections.disconnectOwned(
					f.userId,
					f.connection.id,
					new Date(),
				);
				for (const [name, args] of [
					["read_haunter_settings", {}],
					["update_haunter_settings", { set: { theme: "Dark" } }],
				] as const) {
					const denied = await call(name, args);
					expect(denied.result?.isError).toBeTrue();
					expect(denied.result?.structuredContent).toBeUndefined();
				}
				expect(await f.ctx.ports.embeddedAppearance.get(f.userId)).toEqual({
					theme: "dracula",
				});
			} finally {
				await f.database.close();
			}
		},
	);

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
				title: "Haunter",
				description: expect.stringContaining("notes, tasks, and canvases"),
				websiteUrl: new URL(env.APP_URL).origin,
				icons: [
					expect.objectContaining({
						theme: "light",
						src: expect.stringContaining("data:image/svg+xml;base64,"),
					}),
					expect.objectContaining({
						theme: "dark",
						src: expect.stringContaining("data:image/svg+xml;base64,"),
					}),
				],
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

	test("advertises titles, bounded status labels, and output schemas without losing integration metadata", async () => {
		const body = await json(
			await createHandler("full")(modernRequest("tools/list")),
		);
		const tools = body.result?.tools as Array<{
			name: string;
			title: string;
			outputSchema: Record<string, unknown>;
			_meta: Record<string, unknown>;
		}>;
		expect(tools.length).toBeGreaterThan(0);
		for (const tool of tools) {
			expect(tool.title.length).toBeGreaterThan(0);
			expect(tool.title).not.toContain("_");
			expect(tool.outputSchema).toMatchObject({ type: "object" });
			for (const key of [
				"openai/toolInvocation/invoking",
				"openai/toolInvocation/invoked",
			]) {
				const label = tool._meta[key];
				expect(typeof label).toBe("string");
				expect((label as string).length).toBeGreaterThan(0);
				expect((label as string).length).toBeLessThanOrEqual(64);
			}
		}
		expect(tools.find((tool) => tool.name === "create_page")).toMatchObject({
			title: "Create pages",
			_meta: {
				"openai/toolInvocation/invoking": "Creating page…",
				"openai/toolInvocation/invoked": "Page created",
			},
		});
		for (const name of ["attach_file_to_page", "insert_canvas_image"])
			expect(tools.find((tool) => tool.name === name)?._meta).toMatchObject({
				"openai/fileParams": ["file"],
			});
		for (const name of [
			"authorize_haunter_editor",
			"authorize_haunter_workspace",
		])
			expect(tools.find((tool) => tool.name === name)).toMatchObject({
				outputSchema: {
					type: "object",
					required: ["id"],
					properties: { id: { type: "string", format: "uuid" } },
				},
				_meta: { ui: { visibility: ["app"] } },
			});
		expect(tools.find((tool) => tool.name === "search_mentions")).toMatchObject(
			{
				outputSchema: {
					required: ["items"],
					properties: {
						items: {
							type: "array",
							maxItems: 20,
							items: { properties: { type: { const: "resource_link" } } },
						},
					},
				},
				_meta: {
					"openai/extensions": { "mentions/search": {} },
					ui: { visibility: ["app"] },
				},
			},
		);
	});

	test.each(["authorize_haunter_editor", "authorize_haunter_workspace"])(
		"%s returns a declared handoff and preserves authorization errors",
		async (name) => {
			const { embeddedEditorFixture } = await import(
				"./embedded-editor-fixture"
			);
			const f = await embeddedEditorFixture("view", "view");
			try {
				const handler = createRemoteMcpRequestHandler({
					connection: f.connection,
					identity: { userId: f.userId, clientId: f.connection.clientId },
					getServer: async () => ({
						ports: f.ctx.ports,
						createServiceContext: async () => f.ctx,
					}),
				});
				const args = {
					workspaceId: f.workspaceId,
					challenge: "x".repeat(43),
					...(name === "authorize_haunter_editor" ? { pageId: f.page.id } : {}),
				};
				const authorized = await json(
					await handler(modernRequest("tools/call", { name, arguments: args })),
				);
				expect(authorized.error).toBeUndefined();
				expect(authorized.result?.isError).not.toBeTrue();
				expect(authorized.result?.structuredContent).toEqual({
					id: expect.any(String),
				});
				const denied = await json(
					await handler(
						modernRequest("tools/call", {
							name,
							arguments: { ...args, workspaceId: "foreign" },
						}),
					),
				);
				expect(denied.error).toBeUndefined();
				expect(denied.result?.isError).toBeTrue();
				expect(denied.result?.structuredContent).toBeUndefined();
				expect(denied.result?.content).toEqual([
					{ type: "text", text: "Forbidden" },
				]);
			} finally {
				await f.database.close();
			}
		},
	);

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
		expect(initialized.result?.serverInfo).toMatchObject({
			name: "haunter",
			title: "Haunter",
			websiteUrl: new URL(env.APP_URL).origin,
			icons: [
				expect.objectContaining({ theme: "light" }),
				expect.objectContaining({ theme: "dark" }),
			],
		});
		expect(tools.find((tool) => tool.name === "read_page")).toMatchObject({
			title: "Read pages",
			_meta: {
				"openai/toolInvocation/invoking": "Reading page…",
				"openai/toolInvocation/invoked": "Page read",
			},
		});
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
