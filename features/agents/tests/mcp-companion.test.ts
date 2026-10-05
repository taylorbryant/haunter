import { expect, test } from "bun:test";
import {
	CLIENT_CAPABILITIES_META_KEY,
	CLIENT_INFO_META_KEY,
	PROTOCOL_VERSION_META_KEY,
} from "@modelcontextprotocol/server";
import { eq } from "drizzle-orm";
import type { McpConnectionRow } from "@/features/agents/ports";
import {
	COMPANION_URI,
	pageResourceUri,
	parsePageResourceUri,
} from "@/features/agents/mcp-app/schemas";
import { createTestMcpConnectionRepository } from "@/features/agents/tests/helpers";
import {
	documentFixture,
	paragraph,
	seedFixtureBody,
} from "@/features/documents/tests/helpers";
import * as schema from "@/infra/db/schema";
import { createRemoteMcpRequestHandler } from "@/server/remote-mcp";
import {
	EDITOR_URI,
	editorPaths,
} from "@/features/agents/mcp-app/editor-schema";
import { env } from "@/lib/env";

async function fixture(workspaceId?: string) {
	const f = await documentFixture("viewer", workspaceId);
	await seedFixtureBody(f, [paragraph("Launch plan from the saved page.")]);
	const connection: McpConnectionRow = {
		id: "companion-connection",
		userId: f.userId,
		clientId: "companion-client",
		clientName: "Companion tests",
		permissionProfile: "view",
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
	const handler = createRemoteMcpRequestHandler({
		connection,
		identity: { userId: f.userId, clientId: connection.clientId },
		getServer: async () => ({
			ports: f.ctx.ports,
			createServiceContext: async () => f.ctx,
		}),
	});
	async function rpc(method: string, params: Record<string, unknown> = {}) {
		const response = await handler(
			new Request("https://haunter.test/mcp", {
				method: "POST",
				headers: {
					Accept: "application/json",
					"Content-Type": "application/json",
					"Mcp-Method": method,
					"Mcp-Protocol-Version": "2026-07-28",
					...(typeof (params.name ?? params.uri) === "string"
						? { "Mcp-Name": String(params.name ?? params.uri) }
						: {}),
				},
				body: JSON.stringify({
					jsonrpc: "2.0",
					id: crypto.randomUUID(),
					method,
					params: {
						_meta: {
							[PROTOCOL_VERSION_META_KEY]: "2026-07-28",
							[CLIENT_INFO_META_KEY]: {
								name: "Companion tests",
								version: "1.0.0",
							},
							[CLIENT_CAPABILITIES_META_KEY]: {},
						},
						...params,
					},
				}),
			}),
		);
		return response.json() as Promise<{
			result?: {
				tools?: Array<{
					name: string;
					annotations: Record<string, unknown>;
					_meta: Record<string, unknown>;
				}>;
				structuredContent?: {
					editorUrl?: string;
					webUrl?: string;
					workspaces?: Array<{ id: string }>;
					items?: Array<{ uri: string; type: string; name: string }>;
				};
				contents?: Array<{
					text: string;
					mimeType: string;
					_meta: Record<string, unknown>;
				}>;
				isError?: boolean;
			};
			error?: { message: string };
		}>;
	}
	return {
		...f,
		connection,
		rpc,
		call: (name: string, args: Record<string, unknown> = {}) =>
			rpc("tools/call", { name, arguments: args }),
	};
}

test("workspace IDs round-trip through the MCP browser, editor and encoded page resources", async () => {
	const f = await fixture("team.alpha / 文档?%#");
	try {
		const opened = await f.call("open_haunter");
		expect(opened.result?.structuredContent?.workspaces).toEqual([
			expect.objectContaining({ id: f.workspaceId }),
		]);
		const uri = `haunter://workspaces/${encodeURIComponent(f.workspaceId)}/pages/${f.page.id}`;
		expect(pageResourceUri(f.workspaceId, f.page.id)).toBe(uri);
		expect(parsePageResourceUri(uri)).toEqual({
			workspaceId: f.workspaceId,
			pageId: f.page.id,
		});
		const mentions = await f.call("search_mentions", { query: "" });
		expect(mentions.result?.structuredContent?.items?.[0]?.uri).toBe(uri);
		const page = await f.rpc("resources/read", { uri });
		expect(page.error).toBeUndefined();
		expect(page.result?.contents?.[0]?.text).toContain(
			"Launch plan from the saved page.",
		);
		const editor = await f.call("open_haunter_editor", {
			workspaceId: f.workspaceId,
			pageId: f.page.id,
		});
		expect(editor.result?.structuredContent?.editorUrl).toBe(
			`${new URL(env.APP_URL).origin}/embed/w/${encodeURIComponent(f.workspaceId)}/p/${f.page.id}`,
		);
		for (const malformed of [
			uri.replace("team.alpha", "%ZZ"),
			`${uri}?extra=true`,
			`${uri}#fragment`,
		]) {
			expect(() => parsePageResourceUri(malformed)).toThrow();
		}
	} finally {
		await f.database.close();
	}
});

test("real editor opens an authorized page and only allows Haunter's own iframe origin", async () => {
	const f = await fixture();
	try {
		const listed = await f.rpc("tools/list");
		const opener = listed.result?.tools?.find(
			(tool) => tool.name === "open_haunter_editor",
		);
		expect(opener?._meta).toMatchObject({ ui: { resourceUri: EDITOR_URI } });
		expect(opener?.annotations.readOnlyHint).toBeTrue();
		const origin = new URL(env.APP_URL).origin;
		const opened = await f.call("open_haunter_editor", {
			workspaceId: f.workspaceId,
			pageId: f.page.id,
		});
		expect(opened.result?.structuredContent).toMatchObject({
			editorUrl: `${origin}/embed/w/${f.workspaceId}/p/${f.page.id}`,
			webUrl: `${origin}/w/${f.workspaceId}/p/${f.page.id}`,
		});
		const resource = await f.rpc("resources/read", { uri: EDITOR_URI });
		expect(resource.result?.contents?.[0]?._meta).toMatchObject({
			ui: {
				permissions: { clipboardWrite: {} },
				csp: {
					connectDomains: [],
					resourceDomains: [],
					frameDomains: [origin],
				},
			},
		});
		expect(resource.result?.contents?.[0]?.text).toContain("real-editor");
		f.connection.workspaceIds = [];
		expect(
			(
				await f.call("open_haunter_editor", {
					workspaceId: f.workspaceId,
					pageId: f.page.id,
				})
			).result?.isError,
		).toBeTrue();
	} finally {
		await f.database.close();
	}
});

test("resource and editor paths reject dot segments without reinterpreting literal percent-encoded IDs", () => {
	const pageId = crypto.randomUUID();
	for (const workspaceId of [".", ".."]) {
		expect(() => pageResourceUri(workspaceId, pageId)).toThrow();
		expect(() => editorPaths(workspaceId, pageId)).toThrow();
		for (const segment of [
			workspaceId,
			workspaceId.replaceAll(".", "%2e"),
			workspaceId.replaceAll(".", "%2E"),
		]) {
			expect(() =>
				parsePageResourceUri(`haunter://workspaces/${segment}/pages/${pageId}`),
			).toThrow();
		}
	}
	for (const workspaceId of ["team.alpha", "%2e%2e", "team%2Fone"]) {
		const uri = pageResourceUri(workspaceId, pageId);
		expect(parsePageResourceUri(new URL(uri).href)).toEqual({
			workspaceId,
			pageId,
		});
	}
});

test("companion entrypoints accept empty input and serve a self-contained MCP App", async () => {
	const f = await fixture();
	try {
		const listed = await f.rpc("tools/list");
		const opener = listed.result?.tools?.find(
			(tool) => tool.name === "open_haunter",
		);
		expect(opener?.annotations).toMatchObject({
			readOnlyHint: true,
			destructiveHint: false,
		});
		expect(opener?._meta).toMatchObject({
			ui: { resourceUri: COMPANION_URI },
			"openai/ui": { entrypoints: [{ type: "global" }, { type: "thread" }] },
		});
		expect(
			listed.result?.tools?.find((tool) => tool.name === "search_mentions")
				?._meta,
		).toEqual({
			"openai/extensions": { "mentions/search": {} },
			ui: { visibility: ["app"] },
		});
		const opened = await f.call("open_haunter");
		expect(opened.result?.structuredContent?.workspaces).toEqual([
			expect.objectContaining({ id: f.workspaceId }),
		]);
		const resource = await f.rpc("resources/read", { uri: COMPANION_URI });
		expect(resource.error).toBeUndefined();
		expect(resource.result?.contents?.[0]?.mimeType).toBe(
			"text/html;profile=mcp-app",
		);
		const html = resource.result?.contents?.[0]?.text ?? "";
		expect(html).toContain("Haunter workspace");
		expect(html).toContain("/embed/workspace");
		expect(html).not.toContain("__HAUNTER_APP_ORIGIN__");
		expect(html).not.toContain("Use as context");
		expect(html).toContain("ui/initialize");
		expect(html).not.toMatch(/<script[^>]+src=/);
		expect(html).not.toContain("<!-- script -->");
		expect(resource.result?.contents?.[0]?._meta).toMatchObject({
			ui: {
				permissions: { clipboardWrite: {} },
				csp: {
					connectDomains: [],
					resourceDomains: [],
					frameDomains: [new URL(env.APP_URL).origin],
				},
			},
		});
		const metadata = resource.result?.contents?.[0]?._meta;
		expect((metadata?.ui as { domain?: string })?.domain).toBe(
			env.MCP_UI_DOMAIN,
		);
		expect(metadata?.["openai/widgetDomain"]).toBe(env.MCP_UI_DOMAIN);
		expect(COMPANION_URI).toBe("ui://haunter/workspace/v3");
		expect(EDITOR_URI).toBe(COMPANION_URI);
	} finally {
		await f.database.close();
	}
});

test("mentions browse, search, and resolve saved pages with current authorization", async () => {
	const f = await fixture();
	try {
		for (const query of ["", "D", "Launch"]) {
			const mentions = await f.call("search_mentions", { query });
			expect(mentions.result?.structuredContent?.items).toEqual([
				expect.objectContaining({
					type: "resource_link",
					uri: pageResourceUri(f.workspaceId, f.page.id),
					name: f.page.title,
				}),
			]);
		}
		const page = await f.rpc("resources/read", {
			uri: pageResourceUri(f.workspaceId, f.page.id),
		});
		expect(page.error).toBeUndefined();
		expect(page.result?.contents?.[0]?.text).toContain(
			"Launch plan from the saved page.",
		);
		expect(page.result?.contents?.[0]?._meta).toMatchObject({
			"haunter/page": { revision: expect.any(String) },
		});
		const invalid = await f.rpc("resources/read", {
			uri: `haunter://workspaces/${f.workspaceId}/pages/not-a-page`,
		});
		expect(invalid.error).toBeDefined();
		const oversized = await f.call("search_mentions", {
			query: "x".repeat(201),
		});
		expect(oversized.result?.isError).toBeTrue();
	} finally {
		await f.database.close();
	}
});

test("mentions exclude unapproved workspaces and page resources cannot bypass connection scope", async () => {
	const f = await fixture();
	try {
		await f.database.db.insert(schema.organization).values({
			id: "private-workspace",
			name: "Private",
			slug: "private",
			createdAt: new Date(),
		});
		await f.database.db.insert(schema.member).values({
			id: "private-member",
			organizationId: "private-workspace",
			userId: f.userId,
			role: "owner",
			createdAt: new Date(),
		});
		const opened = await f.call("open_haunter");
		expect(
			opened.result?.structuredContent?.workspaces?.map((w) => w.id),
		).toEqual([f.workspaceId]);
		const mentions = await f.call("search_mentions", { query: "" });
		expect(
			mentions.result?.structuredContent?.items?.every((item) =>
				item.uri.includes(`/${f.workspaceId}/`),
			),
		).toBeTrue();
		const denied = await f.rpc("resources/read", {
			uri: pageResourceUri("private-workspace", f.page.id),
		});
		expect(denied.error).toBeDefined();
		expect(denied.result?.contents).toBeUndefined();
		// A previously issued URI is also denied after the connection scope shrinks.
		f.connection.workspaceIds = [];
		expect(
			(
				await f.rpc("resources/read", {
					uri: pageResourceUri(f.workspaceId, f.page.id),
				})
			).error,
		).toBeDefined();
	} finally {
		await f.database.close();
	}
});

test("revocation and removed membership invalidate existing mention resources", async () => {
	const f = await fixture();
	try {
		const uri = pageResourceUri(f.workspaceId, f.page.id);
		expect((await f.rpc("resources/read", { uri })).error).toBeUndefined();
		await f.database.db
			.delete(schema.member)
			.where(eq(schema.member.organizationId, f.workspaceId));
		expect((await f.rpc("resources/read", { uri })).error).toBeDefined();
		expect(
			(await f.call("search_mentions", { query: "" })).result?.structuredContent
				?.items,
		).toEqual([]);
		f.connection.status = "revoked";
		expect((await f.rpc("resources/read", { uri })).error).toBeDefined();
		expect((await f.call("open_haunter")).result?.isError).toBeTrue();
		expect(
			(await f.call("search_mentions", { query: "" })).result?.isError,
		).toBeTrue();
	} finally {
		await f.database.close();
	}
});

test("the canvas opener returns a scoped destination for view connections and rejects inaccessible canvases", async () => {
	const { createCanvasSyncServer } = await import(
		"@/infra/canvases/sync-server"
	);
	const { validateEditorOutput } = await import("../mcp-app/editor-schema");
	const f = await fixture();
	const engine = createCanvasSyncServer({
		verify() {
			throw new Error("No socket in this test");
		},
		authorize: async () => ({ ctx: f.ctx, role: "viewer" }),
	});
	f.ctx.ports.canvasEditing = {
		execute: ({ command }) => engine.execute(f.ctx, command),
	};
	try {
		const canvas = await f.ctx.ports.canvases.create(f.scope, {
			userId: f.userId,
			pageId: null,
			title: "System design",
		});
		const opened = await f.call("open_haunter_canvas", {
			workspaceId: f.workspaceId,
			canvasId: canvas.id,
		});
		expect(opened.result?.isError).toBeUndefined();
		expect(
			validateEditorOutput(opened.result?.structuredContent),
		).toMatchObject({
			canvasId: canvas.id,
			pageId: null,
			title: "System design",
		});
		const inaccessible = await f.call("open_haunter_canvas", {
			workspaceId: f.workspaceId,
			canvasId: crypto.randomUUID(),
		});
		expect(inaccessible.result?.isError).toBeTrue();
		f.connection.workspaceIds = [];
		const removed = await f.call("open_haunter_canvas", {
			workspaceId: f.workspaceId,
			canvasId: canvas.id,
		});
		expect(removed.result?.isError).toBeTrue();
	} finally {
		await engine.stop();
		await f.database.close();
	}
});

test("task opener resolves completed tasks beyond list pagination and enforces page, workspace and connection access", async () => {
	const f = await fixture();
	try {
		const input = {
			userId: f.userId,
			pageId: null,
			sourceBlockId: null,
			title: "Earlier task",
			completed: false,
			completedAt: null,
			dueDate: "2026-01-01",
			dueTime: null,
			reminderOffsetMinutes: null,
			assigneeId: null,
		};
		for (let i = 0; i < 51; i++)
			await f.database.repositories.tasks.create(f.scope, input);
		const task = await f.database.repositories.tasks.create(f.scope, {
			...input,
			title: "Selected completed task",
			pageId: f.page.id,
			sourceBlockId: "selected-block",
			dueDate: null,
			completed: true,
			completedAt: new Date().toISOString(),
		});
		const args = { workspaceId: f.workspaceId, taskId: task.id };
		const opened = await f.call("open_haunter", args);
		expect(opened.result?.isError).not.toBeTrue();
		expect(opened.result?.structuredContent).toMatchObject({
			target: { ...args, view: "tasks", filter: "all", scope: "everyone" },
		});
		const filtered = await f.call("list_tasks", {
			...args,
			filter: "all",
			scope: "everyone",
			limit: 1,
		});
		expect(filtered.result?.structuredContent).toMatchObject({
			tasks: [{ taskId: task.id }],
		});
		expect(
			(await f.call("open_haunter", { ...args, workspaceId: "unapproved" }))
				.result?.isError,
		).toBeTrue();
		expect(
			(await f.call("open_haunter", { ...args, taskId: crypto.randomUUID() }))
				.result?.isError,
		).toBeTrue();
		await f.database.db
			.update(schema.pages)
			.set({ deletedAt: new Date().toISOString() })
			.where(eq(schema.pages.id, f.page.id));
		expect((await f.call("open_haunter", args)).result?.isError).toBeTrue();
		await f.database.db
			.update(schema.pages)
			.set({ deletedAt: null })
			.where(eq(schema.pages.id, f.page.id));
		f.connection.status = "revoked";
		expect((await f.call("open_haunter", args)).result?.isError).toBeTrue();
	} finally {
		await f.database.close();
	}
});
