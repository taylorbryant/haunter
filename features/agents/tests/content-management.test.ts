import { expect, test } from "bun:test";
import { createTenantScope } from "@beignet/core/ports";
import { createRecordingBestEffortWork } from "@beignet/core/testing";
import { createBetterAuthAgentCapabilityTestContext } from "@beignet/agent-auth-better-auth/testing";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { McpConnectionRow } from "../ports";
import {
	createTestAgentAdminRepository,
	createTestMcpConnectionRepository,
} from "./helpers";
import {
	documentFixture,
	paragraph,
	seedFixtureBody,
} from "@/features/documents/tests/helpers";
import { readPageDocumentUseCase } from "@/features/pages/use-cases/read-page-document";
import { setPageFavoriteUseCase } from "@/features/pages/use-cases/set-page-favorite";
import { setCanvasFavoriteUseCase } from "@/features/canvases/use-cases/set-canvas-favorite";
import { workspaceFavorites } from "@/features/collab/channels";
import {
	createHaunterAgentCapabilityExecutor,
	executeRemoteMcpCapability,
} from "@/server/agent-capabilities";
import { createHaunterAgentAuthAdapter } from "@/lib/agent-auth-adapter";
import { createRemoteMcpRequestHandler } from "@/server/remote-mcp";
import * as schema from "@/infra/db/schema";

async function fixture(
	profile: McpConnectionRow["permissionProfile"] = "full",
	role = "owner",
) {
	const f = await documentFixture(role);
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
				arguments: { workspaceId: f.workspaceId, ...args },
				userId: f.userId,
				clientId: "client",
			},
			{ getServer: async () => server },
		);
	const read = () =>
		readPageDocumentUseCase.run({ ctx: f.ctx, input: { id: f.page.id } });
	const checkpoint = async () => {
		const current = await read();
		return f.database.repositories.pageVersions.create(f.scope, {
			pageId: f.page.id,
			title: current.title,
			icon: null,
			contentJson: JSON.stringify(current.blocks),
			cause: "checkpoint",
			createdBy: f.userId,
		});
	};
	return { ...f, connection, server, execute, read, checkpoint };
}

test.each(["page", "canvas"] as const)(
	"MCP and shared app %s favorite writes publish private hints only after persistence",
	async (resourceType) => {
		const f = await fixture();
		try {
			const id =
				resourceType === "page"
					? f.page.id
					: (
							await f.database.repositories.canvases.create(f.scope, {
								userId: f.userId,
								pageId: null,
								title: "Favorite",
							})
						).id;
			const idArg = resourceType === "page" ? "pageId" : "canvasId";
			const navigation =
				resourceType === "page"
					? f.ctx.ports.pageNavigation
					: f.ctx.ports.canvasNavigation;
			const work = createRecordingBestEffortWork();
			f.ctx.ports.bestEffortWork = work.bestEffortWork;
			const published: unknown[] = [];
			let failPublication = false;
			f.ctx.ports.broadcast = {
				async publish(channel, message) {
					if (failPublication) throw new Error("Broadcast unavailable");
					published.push({ channel: channel.name, ...message });
				},
				subscribe() {
					throw new Error("This test only records publications");
				},
			};
			const favorite = (targetId = id) =>
				f.execute(`set_${resourceType}_favorite`, {
					[idArg]: targetId,
					favorite: true,
				});
			await favorite();
			expect(
				(await navigation.listForUser(f.scope, f.userId, 10)).favorites,
			).toHaveLength(1);
			expect(published).toEqual([]);
			expect(work.pending).toHaveLength(1);
			await work.flush();
			const expected = {
				channel: workspaceFavorites.name,
				params: { workspaceId: f.workspaceId, userId: f.userId },
				event: "changed",
				data: {
					schemaVersion: 1,
					type: "favorites.changed",
					workspaceId: f.workspaceId,
					userId: f.userId,
					resourceType,
					occurredAt: expect.any(String),
				},
			};
			expect(published).toEqual([expected]);
			// HTTP and MCP share the same use case and must notify the same sessions.
			const input = { id, favorite: false };
			if (resourceType === "page")
				await setPageFavoriteUseCase.run({ ctx: f.ctx, input });
			else await setCanvasFavoriteUseCase.run({ ctx: f.ctx, input });
			await work.flush();
			expect(published).toEqual([expected, expected]);
			expect(
				(await navigation.listForUser(f.scope, f.userId, 10)).favorites,
			).toHaveLength(0);
			await expect(favorite(crypto.randomUUID())).rejects.toThrow();
			expect(work.pending).toHaveLength(0);
			const persist = navigation.setFavorite;
			navigation.setFavorite = async () => {
				throw new Error("Write failed");
			};
			await expect(favorite()).rejects.toThrow();
			expect(work.pending).toHaveLength(0);
			navigation.setFavorite = persist;
			failPublication = true;
			await favorite();
			await work.flush();
			expect(
				(await navigation.listForUser(f.scope, f.userId, 10)).favorites,
			).toHaveLength(1);
			expect(published).toHaveLength(2);
		} finally {
			await f.database.close();
		}
	},
);

test("MCP manages standalone canvases and personal favorites without exposing drawing payloads", async () => {
	const f = await fixture();
	try {
		const created = await f.execute("create_canvas", { title: "Planning" });
		const { canvasId } = z.object({ canvasId: z.uuid() }).parse(created);
		expect(created).toMatchObject({
			title: "Planning",
			pageId: null,
			workspaceId: f.workspaceId,
		});
		expect(created).not.toHaveProperty("snapshot");
		expect(created).not.toHaveProperty("userId");
		await f.execute("update_canvas", { canvasId, title: "Plan for launch" });
		expect(await f.execute("list_canvases")).toMatchObject({
			canvases: [{ canvasId, title: "Plan for launch" }],
		});
		for (let i = 0; i < 2; i++)
			await f.execute("set_canvas_favorite", { canvasId, favorite: true });
		expect(await f.execute("list_canvas_favorites")).toMatchObject({
			canvases: [{ canvasId, favoritedAt: expect.any(String) }],
		});
		await f.execute("set_canvas_favorite", { canvasId, favorite: false });
		expect(await f.execute("list_canvas_favorites")).toEqual({ canvases: [] });
		await f.execute("set_canvas_favorite", { canvasId, favorite: true });
		await f.database.repositories.canvases.saveHistory(f.scope, {
			canvasId,
			revision: 0,
			snapshotJson: "{}",
			createdBy: f.userId,
		});
		expect(await f.execute("delete_canvas", { canvasId })).toEqual({
			canvasId,
			deleted: true,
		});
		expect(
			await f.database.repositories.canvases.findById(f.scope, canvasId),
		).toBeNull();
		expect(
			await f.database.repositories.canvases.listHistory(f.scope, canvasId),
		).toEqual([]);
		expect(await f.execute("list_canvases")).toEqual({ canvases: [] });
		expect(await f.execute("list_canvas_favorites")).toEqual({ canvases: [] });
	} finally {
		await f.database.close();
	}
});

test("standalone management cannot rename, favorite, or delete a page's inline canvas", async () => {
	const f = await fixture();
	try {
		const canvas = await f.database.repositories.canvases.create(f.scope, {
			userId: f.userId,
			pageId: f.page.id,
			title: null,
		});
		expect(await f.execute("list_canvases")).toEqual({ canvases: [] });
		for (const [name, args] of [
			["update_canvas", { title: "Wrong path" }],
			["set_canvas_favorite", { favorite: true }],
			["delete_canvas", {}],
		] as const) {
			await expect(
				f.execute(name, { canvasId: canvas.id, ...args }),
			).rejects.toMatchObject({ code: "CANVAS_NOT_EDITABLE" });
		}
		await expect(
			f.execute("create_canvas", { title: "Inline?", pageId: f.page.id }),
		).rejects.toThrow();
		expect(
			await f.database.repositories.canvases.findById(f.scope, canvas.id),
		).toEqual(canvas);
	} finally {
		await f.database.close();
	}
});

test("favorite tools act for the authenticated user and exclude archived pages", async () => {
	const f = await fixture();
	try {
		const now = new Date();
		await f.database.db.insert(schema.user).values({
			id: "other-user",
			name: "Other",
			email: "other@example.com",
			emailVerified: true,
			accessStatus: "approved",
			createdAt: now,
			updatedAt: now,
		});
		await f.database.db.insert(schema.member).values({
			id: "other-member",
			organizationId: f.workspaceId,
			userId: "other-user",
			role: "member",
			createdAt: now,
		});
		await f.database.repositories.pageNavigation.setFavorite(
			f.scope,
			"other-user",
			f.page.id,
			true,
		);
		const canvas = await f.database.repositories.canvases.create(f.scope, {
			userId: f.userId,
			pageId: null,
			title: "Other favorite",
		});
		await f.database.repositories.canvasNavigation.setFavorite(
			f.scope,
			"other-user",
			canvas.id,
			true,
		);
		expect(await f.execute("list_page_favorites")).toEqual({ pages: [] });
		expect(await f.execute("list_canvas_favorites")).toEqual({ canvases: [] });
		for (let i = 0; i < 2; i++)
			await f.execute("set_page_favorite", {
				pageId: f.page.id,
				favorite: true,
			});
		expect(await f.execute("list_page_favorites")).toMatchObject({
			pages: [
				{
					pageId: f.page.id,
					title: "Document",
					favoritedAt: expect.any(String),
				},
			],
		});
		await f.execute("set_page_favorite", {
			pageId: f.page.id,
			favorite: false,
		});
		expect(await f.execute("list_page_favorites")).toEqual({ pages: [] });
		expect(
			(
				await f.database.repositories.pageNavigation.listForUser(
					f.scope,
					"other-user",
					10,
				)
			).favorites,
		).toHaveLength(1);
		await f.execute("set_page_favorite", { pageId: f.page.id, favorite: true });
		await f.execute("archive_page", { pageId: f.page.id });
		expect(await f.execute("list_page_favorites")).toEqual({ pages: [] });
		await expect(
			f.execute("set_page_favorite", { pageId: f.page.id, favorite: true }),
		).rejects.toMatchObject({ code: "PAGE_NOT_FOUND" });
	} finally {
		await f.database.close();
	}
});

test("backlinks include page links and mentions, and trash recovers page subtrees", async () => {
	const f = await fixture();
	try {
		const target = await f.database.repositories.pages.create(f.scope, {
			userId: f.userId,
			title: "Target",
			parentPageId: null,
			position: 1,
		});
		const child = await f.database.repositories.pages.create(f.scope, {
			userId: f.userId,
			title: "Child",
			parentPageId: f.page.id,
			position: 0,
		});
		await seedFixtureBody(
			f,
			[
				{
					id: "link",
					type: "pageLink",
					props: { pageId: target.id, workspaceId: f.workspaceId },
					children: [],
				},
			],
			true,
		);
		await seedFixtureBody(
			{ ...f, page: child },
			[
				{
					id: "mention",
					type: "paragraph",
					props: {},
					content: [
						{
							type: "mention",
							props: {
								pageId: target.id,
								workspaceId: f.workspaceId,
								label: "Target",
							},
						},
					],
					children: [],
				},
			],
			true,
		);
		expect(
			await f.execute("list_backlinks", { pageId: target.id }),
		).toMatchObject({
			pages: expect.arrayContaining([
				{
					pageId: f.page.id,
					title: "Document",
					icon: null,
					parentPageId: null,
					updatedAt: expect.any(String),
				},
				expect.objectContaining({ pageId: child.id }),
			]),
		});
		await f.execute("archive_page", { pageId: f.page.id });
		expect(await f.execute("list_backlinks", { pageId: target.id })).toEqual({
			pages: [],
		});
		expect(await f.execute("list_trash")).toMatchObject({
			pages: [{ pageId: f.page.id, deletedAt: expect.any(String) }],
		});
		await expect(
			f.execute("list_page_versions", { pageId: f.page.id }),
		).rejects.toMatchObject({ code: "PAGE_NOT_FOUND" });
		await f.execute("restore_page", { pageId: f.page.id });
		expect(await f.execute("list_trash")).toEqual({ pages: [] });
		expect(
			(await f.database.repositories.pages.findMetaById(f.scope, child.id))
				?.deletedAt,
		).toBeNull();
		expect(
			await f.execute("list_backlinks", { pageId: target.id }),
		).toMatchObject({
			pages: expect.arrayContaining([
				expect.objectContaining({ pageId: f.page.id }),
				expect.objectContaining({ pageId: child.id }),
			]),
		});
	} finally {
		await f.database.close();
	}
});

test("history tools inspect rich snapshots and restore bodies with recovery, tasks, and backlinks", async () => {
	const f = await fixture();
	try {
		const target = await f.database.repositories.pages.create(f.scope, {
			userId: f.userId,
			title: "Target",
			parentPageId: null,
			position: 1,
		});
		await seedFixtureBody(
			f,
			[
				paragraph("Saved body"),
				{
					id: "image",
					type: "image",
					props: {
						url: "https://example.com/image.png",
						caption: "Saved image",
					},
					children: [],
				},
				{
					id: "task",
					type: "task",
					props: { checked: false, assignee: f.userId },
					content: [{ type: "text", text: "Recovered task", styles: {} }],
					children: [],
				},
				{
					id: "link",
					type: "pageLink",
					props: { pageId: target.id, workspaceId: f.workspaceId },
					children: [],
				},
			],
			true,
		);
		const original = await f.read();
		const version = await f.checkpoint();
		await seedFixtureBody(f, [paragraph("Newer body")], true);
		await f.execute("update_page", {
			pageId: f.page.id,
			title: "New title",
			icon: "👻",
		});
		const before = await f.read();
		expect(
			await f.execute("list_page_versions", { pageId: f.page.id }),
		).toMatchObject({
			versions: [
				{
					versionId: version.id,
					pageId: f.page.id,
					title: "Document",
					cause: "checkpoint",
					createdBy: f.userId,
				},
			],
		});
		const historical = await f.execute("read_page_version", {
			pageId: f.page.id,
			versionId: version.id,
			format: "both",
		});
		expect(historical).toMatchObject({
			blocks: original.blocks,
			markdown: expect.stringContaining("Saved body"),
		});
		expect(historical).not.toHaveProperty("revision");
		expect(
			await f.execute("read_page_version", {
				pageId: f.page.id,
				versionId: version.id,
			}),
		).not.toHaveProperty("blocks");
		expect(
			await f.execute("read_page_version", {
				pageId: f.page.id,
				versionId: version.id,
				format: "blocks",
			}),
		).not.toHaveProperty("markdown");
		expect(
			await f.execute("restore_page_version", {
				pageId: f.page.id,
				versionId: version.id,
				expectedRevision: before.revision,
			}),
		).toMatchObject({
			restored: true,
			documentGeneration: 1,
			tasksChanged: true,
			linksChanged: true,
		});
		const after = await f.read();
		expect(after.blocks).toEqual(original.blocks);
		expect(after.revision).not.toBe(before.revision);
		expect(after.title).toBe("New title");
		expect(
			(await f.database.repositories.pages.findMetaById(f.scope, f.page.id))
				?.icon,
		).toBe("👻");
		const recovery = (
			await f.database.repositories.pageVersions.listMetaByPage(
				f.scope,
				f.page.id,
			)
		).find((v) => v.cause === "restore");
		expect(recovery).toBeDefined();
		expect(
			(
				await f.database.repositories.pageVersions.findById(
					f.scope,
					recovery!.id,
				)
			)?.content,
		).toEqual(before.blocks);
		expect(
			await f.database.repositories.tasks.listByPage(f.scope, f.page.id),
		).toMatchObject([{ title: "Recovered task" }]);
		expect(
			await f.execute("list_backlinks", { pageId: target.id }),
		).toMatchObject({ pages: [{ pageId: f.page.id }] });
	} finally {
		await f.database.close();
	}
});

test("restoration rejects stale revisions, missing revisions, and versions belonging to another page without writes", async () => {
	const f = await fixture();
	try {
		await seedFixtureBody(f, [paragraph("Original")]);
		const old = await f.read();
		const version = await f.checkpoint();
		await f.execute("append_to_page", {
			pageId: f.page.id,
			markdown: "New edit",
		});
		const current = await f.read();
		const history = await f.database.repositories.pageVersions.listMetaByPage(
			f.scope,
			f.page.id,
		);
		const restore = (args: Record<string, unknown>) =>
			f.execute("restore_page_version", {
				pageId: f.page.id,
				versionId: version.id,
				...args,
			});
		await expect(
			restore({ expectedRevision: old.revision }),
		).rejects.toMatchObject({
			code: "REVISION_CONFLICT",
			details: { currentRevision: current.revision },
		});
		await expect(restore({})).rejects.toThrow();
		const another = await f.database.repositories.pages.create(f.scope, {
			userId: f.userId,
			title: "Another",
			parentPageId: null,
			position: 1,
		});
		const otherVersion = await f.database.repositories.pageVersions.create(
			f.scope,
			{
				pageId: another.id,
				title: "Another",
				icon: null,
				contentJson: "[]",
				cause: "checkpoint",
				createdBy: f.userId,
			},
		);
		await expect(
			restore({
				expectedRevision: current.revision,
				versionId: otherVersion.id,
			}),
		).rejects.toMatchObject({ code: "PAGE_NOT_FOUND" });
		await expect(
			f.execute("read_page_version", {
				pageId: f.page.id,
				versionId: otherVersion.id,
			}),
		).rejects.toMatchObject({ code: "PAGE_NOT_FOUND" });
		expect(await f.read()).toEqual(current);
		expect(
			await f.database.repositories.pageVersions.listMetaByPage(
				f.scope,
				f.page.id,
			),
		).toEqual(history);
	} finally {
		await f.database.close();
	}
});

test("connection profiles and workspace roles independently restrict management", async () => {
	const f = await fixture("view");
	try {
		const version = await f.checkpoint();
		const canvas = await f.database.repositories.canvases.create(f.scope, {
			userId: f.userId,
			pageId: null,
			title: "Keep",
		});
		await expect(
			f.execute("create_canvas", { title: "Denied" }),
		).rejects.toMatchObject({ status: "FORBIDDEN" });
		await expect(
			f.execute("set_page_favorite", { pageId: f.page.id, favorite: true }),
		).rejects.toMatchObject({ status: "FORBIDDEN" });
		f.connection.permissionProfile = "edit";
		await f.execute("set_page_favorite", { pageId: f.page.id, favorite: true });
		await expect(
			f.execute("delete_canvas", { canvasId: canvas.id }),
		).rejects.toMatchObject({ status: "FORBIDDEN" });
		await expect(
			f.execute("restore_page_version", {
				pageId: f.page.id,
				versionId: version.id,
				expectedRevision: (await f.read()).revision,
			}),
		).rejects.toMatchObject({ status: "FORBIDDEN" });
		expect(
			await f.database.repositories.canvases.findById(f.scope, canvas.id),
		).not.toBeNull();
	} finally {
		await f.database.close();
	}
	const viewer = await fixture("full", "viewer");
	try {
		const version = await viewer.checkpoint();
		await expect(
			viewer.execute("create_canvas", { title: "Denied" }),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
		await expect(
			viewer.execute("restore_page_version", {
				pageId: viewer.page.id,
				versionId: version.id,
				expectedRevision: (await viewer.read()).revision,
			}),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
		await viewer.execute("set_page_favorite", {
			pageId: viewer.page.id,
			favorite: true,
		});
		expect(await viewer.execute("list_page_favorites")).toMatchObject({
			pages: [{ pageId: viewer.page.id }],
		});
	} finally {
		await viewer.database.close();
	}
});

test("foreign resources and revoked membership cannot be reached through the new tools", async () => {
	const f = await fixture();
	try {
		const scope = createTenantScope({ id: "foreign-workspace" });
		await f.database.db.insert(schema.organization).values({
			id: "foreign-workspace",
			name: "Foreign",
			slug: "foreign",
			createdAt: new Date(),
		});
		const page = await f.database.repositories.pages.create(scope, {
			userId: f.userId,
			title: "Foreign",
			parentPageId: null,
			position: 0,
		});
		const canvas = await f.database.repositories.canvases.create(scope, {
			userId: f.userId,
			pageId: null,
			title: "Foreign",
		});
		for (const [name, args] of [
			["set_page_favorite", { pageId: page.id, favorite: true }],
			["list_backlinks", { pageId: page.id }],
			["list_page_versions", { pageId: page.id }],
			["update_canvas", { canvasId: canvas.id, title: "Denied" }],
			["set_canvas_favorite", { canvasId: canvas.id, favorite: true }],
			["delete_canvas", { canvasId: canvas.id }],
		] as const)
			await expect(f.execute(name, args)).rejects.toMatchObject({
				status: 404,
			});
		for (const name of [
			"list_canvases",
			"list_canvas_favorites",
			"list_page_favorites",
			"list_trash",
		]) {
			await expect(
				f.execute(name, { workspaceId: "foreign-workspace" }),
			).rejects.toMatchObject({ status: "FORBIDDEN" });
		}
		await f.database.db
			.delete(schema.member)
			.where(eq(schema.member.id, "document-member"));
		await expect(f.execute("list_trash")).rejects.toMatchObject({
			status: "FORBIDDEN",
		});
		await expect(
			f.execute("create_canvas", { title: "Denied" }),
		).rejects.toMatchObject({ status: "FORBIDDEN" });
	} finally {
		await f.database.close();
	}
});

test("Agent Auth executes the new capabilities with workspace constraints", async () => {
	const f = await fixture();
	try {
		f.ctx.ports.agents = createTestAgentAdminRepository();
		const adapter = createHaunterAgentAuthAdapter(
			await createHaunterAgentCapabilityExecutor({
				getServer: async () => f.server,
			}),
		);
		if (!adapter.onExecute) throw new Error("Missing Agent Auth executor");
		const context = createBetterAuthAgentCapabilityTestContext({
			capability: "create_canvas",
			userId: f.userId,
			constraints: { workspaceId: f.workspaceId },
			arguments: { workspaceId: f.workspaceId, title: "Agent canvas" },
		});
		expect(await adapter.onExecute(context)).toMatchObject({
			title: "Agent canvas",
			pageId: null,
		});
		const denied = createBetterAuthAgentCapabilityTestContext({
			capability: "create_canvas",
			userId: f.userId,
			constraints: null,
			arguments: { workspaceId: f.workspaceId, title: "Denied" },
		});
		await expect(adapter.onExecute(denied)).rejects.toThrow(
			'The active grant for capability "create_canvas" is missing required constraints: workspaceId.',
		);
		expect(await f.execute("list_canvases")).toMatchObject({
			canvases: [{ title: "Agent canvas" }],
		});
	} finally {
		await f.database.close();
	}
});

test("MCP HTTP calls serialize new tool results and actionable restore conflicts", async () => {
	const f = await fixture();
	try {
		const handler = createRemoteMcpRequestHandler({
			connection: f.connection,
			identity: { userId: f.userId, clientId: "client" },
			getServer: async () => f.server,
		});
		const call = async (name: string, args: Record<string, unknown>) => {
			const response = await handler(
				new Request("https://haunter.test/mcp", {
					method: "POST",
					headers: {
						Accept: "application/json, text/event-stream",
						"Content-Type": "application/json",
						"Mcp-Protocol-Version": "2025-06-18",
					},
					body: JSON.stringify({
						jsonrpc: "2.0",
						id: crypto.randomUUID(),
						method: "tools/call",
						params: {
							name,
							arguments: { workspaceId: f.workspaceId, ...args },
						},
					}),
				}),
			);
			expect(response.status).toBe(200);
			const payload = (await response.text())
				.split("\n")
				.find((line) => line.startsWith("data: "))
				?.slice(6);
			if (!payload) throw new Error("Expected an MCP response event");
			return z
				.object({
					result: z.object({
						isError: z.boolean().optional(),
						structuredContent: z.unknown().optional(),
						content: z.array(
							z.object({ type: z.string(), text: z.string().optional() }),
						),
					}),
				})
				.parse(JSON.parse(payload)).result;
		};
		const created = await call("create_canvas", { title: "From MCP" });
		expect(created.isError).not.toBe(true);
		expect(created.structuredContent).toMatchObject({
			title: "From MCP",
			canvasId: expect.any(String),
		});
		const version = await f.checkpoint();
		const before = await f.read();
		const args = {
			pageId: f.page.id,
			versionId: version.id,
			expectedRevision: before.revision,
		};
		const restored = await call("restore_page_version", args);
		expect(restored.isError).not.toBe(true);
		expect(restored.structuredContent).toMatchObject({
			pageId: f.page.id,
			restored: true,
			documentGeneration: 1,
		});
		const repeated = await call("restore_page_version", args);
		expect(repeated.isError).toBe(true);
		expect(JSON.parse(repeated.content[0]!.text!)).toMatchObject({
			code: "REVISION_CONFLICT",
			currentRevision: (await f.read()).revision,
		});
	} finally {
		await f.database.close();
	}
});
