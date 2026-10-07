import { createCanvasStructureEditor } from "@/infra/canvases/structure-editor";
import { createHaunterAgentAuthAdapter } from "@/lib/agent-auth-adapter";
import { createBetterAuthAgentCapabilityTestContext } from "@beignet/agent-auth-better-auth/testing";
import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { documentFixture } from "@/features/documents/tests/helpers";
import { readPageDocumentUseCase } from "@/features/pages/use-cases/read-page-document";
import { createTestMcpConnectionRepository } from "@/features/agents/tests/helpers";
import type { McpConnectionRow } from "@/features/agents/ports";
import { createCanvasSyncServer } from "@/infra/canvases/sync-server";
import {
	createCanvasCommandHandler,
	createCanvasEditingClient,
} from "@/infra/canvases/command-bridge";
import {
	createHaunterAgentCapabilityExecutor,
	executeRemoteMcpCapability,
} from "@/server/agent-capabilities";
import * as schema from "@/infra/db/schema";
import {
	CanvasReadOutputSchema,
	CanvasEditOutputSchema,
	InsertCanvasLibraryItemOutputSchema,
} from "../editing";
import { SearchCanvasLibraryOutputSchema } from "../library-schemas";
import { CANVAS_LIBRARY_ITEMS } from "../lib/library";
import { createCanvasBlockUseCase } from "../use-cases/create-canvas-block";
import { CanvasPreviewOutputSchema } from "../editing";
import type { CanvasPreviewRenderer, CanvasStructureEditor } from "../ports";
import { createCanvasPreviewRenderer } from "@/infra/canvases/preview-renderer";
import { createRemoteMcpRequestHandler } from "@/server/remote-mcp";
import type { TLRecord, TLShape } from "@tldraw/tlschema";
import { prepareCanvasEdit } from "@/infra/canvases/shape-edits";
import { normalizeCanvasSnapshot } from "../lib/document";
import {
	CLIENT_CAPABILITIES_META_KEY,
	CLIENT_INFO_META_KEY,
	PROTOCOL_VERSION_META_KEY,
} from "@modelcontextprotocol/server";

async function fixture(
	profile: McpConnectionRow["permissionProfile"] = "full",
	role = "owner",
	previewRenderer?: CanvasPreviewRenderer,
	structureEditor?: CanvasStructureEditor,
) {
	const f = await documentFixture(role);
	const connection: McpConnectionRow = {
		id: "canvas-mcp",
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
	f.ctx.ports.mcpConnections = createTestMcpConnectionRepository(
		[connection],
		[],
	);
	f.ctx.ports.workspaceEventStreamLeases = {
		isConfigured: () => false,
		acquire: async () => null,
	};
	const engine = createCanvasSyncServer({
		previewRenderer,
		structureEditor,
		verify() {
			throw new Error("Not a browser session");
		},
		authorize: async () => ({ ctx: f.ctx, role }),
	});
	const handler = createCanvasCommandHandler({
		secret: "canvas-bridge-test-secret",
		canvases: engine,
		authorize: async () => f.ctx,
	});
	const transport = Bun.serve({
		port: 0,
		hostname: "127.0.0.1",
		fetch: handler,
	});
	const client = createCanvasEditingClient({
		url: `http://127.0.0.1:${transport.port}`,
		secret: "canvas-bridge-test-secret",
	});
	f.ctx.ports.canvasEditing = client;
	const server = {
		ports: f.ctx.ports,
		createServiceContext: async () => f.ctx,
	};
	const execute = (capability: string, args: Record<string, unknown>) =>
		executeRemoteMcpCapability(
			{
				capability,
				arguments: { workspaceId: f.workspaceId, ...args },
				userId: f.userId,
				clientId: "client",
			},
			{ getServer: async () => server },
		);
	const readPage = () =>
		readPageDocumentUseCase.run({ ctx: f.ctx, input: { id: f.page.id } });
	const create = async () =>
		execute("create_canvas_block", {
			pageId: f.page.id,
			expectedRevision: (await readPage()).revision,
		}) as ReturnType<typeof createCanvasBlockUseCase.run>;
	const read = async (canvasId: string, historyVersionId?: string) =>
		CanvasReadOutputSchema.parse(
			await execute("read_canvas", {
				canvasId,
				...(historyVersionId ? { historyVersionId } : {}),
			}),
		);
	const edit = async (
		canvasId: string,
		operations: unknown[],
		expectedRevision?: string,
	) =>
		CanvasEditOutputSchema.parse(
			await execute("edit_canvas", {
				canvasId,
				operations,
				expectedRevision: expectedRevision ?? (await read(canvasId)).revision,
			}),
		);
	return {
		...f,
		engine,
		client,
		handler,
		execute,
		create,
		read,
		readPage,
		edit,
		connection,
		server,
		async stop() {
			await engine.stop();
			await transport.stop(true);
			await f.database.close();
		},
	};
}

const libraryItem = CANVAS_LIBRARY_ITEMS.find(
	(item) => item.id === "request-flow",
)!;
const libraryArgs = {
	itemId: libraryItem.id,
	itemVersion: libraryItem.version,
	x: 200,
	y: 300,
	scale: 0.5,
};

test("MCP searches the shared catalog, inserts templates through the worker, and edits named parts with revision/history safety", async () => {
	const f = await fixture("edit");
	try {
		const search = SearchCanvasLibraryOutputSchema.parse(
			await f.execute("search_canvas_library", {
				query: "REQUEST",
				kind: "template",
				category: "architecture",
			}),
		);
		expect(search.items.map((item) => item.id)).toContain(libraryItem.id);
		expect(
			search.items.find((item) => item.id === libraryItem.id),
		).toMatchObject({
			version: libraryItem.version,
			shapeCount: libraryItem.elements.length,
			description: libraryItem.description,
		});
		const { canvasId, canvasRevision } = await f.create();
		const before = await f.read(canvasId);
		const args = { ...libraryArgs, canvasId, expectedRevision: canvasRevision };
		for (const invalid of [
			{ itemId: "missing" },
			{ itemVersion: libraryItem.version + 1 },
			{ scale: 0 },
			{ scale: 5 },
			{ x: 1_000_001 },
			{ pageId: "page:missing" },
			{ shapes: [] },
		]) {
			await expect(
				f.execute("insert_canvas_library_item", { ...args, ...invalid }),
			).rejects.toThrow();
			expect(await f.read(canvasId)).toEqual(before);
		}
		const competing = await Promise.allSettled([
			f.execute("insert_canvas_library_item", args),
			f.execute("insert_canvas_library_item", args),
		]);
		expect(
			competing.filter((result) => result.status === "fulfilled"),
		).toHaveLength(1);
		expect(
			competing.find((result) => result.status === "rejected"),
		).toMatchObject({ reason: { code: "CANVAS_REVISION_CONFLICT" } });
		const successful = competing.find(
			(result) => result.status === "fulfilled",
		);
		if (successful?.status !== "fulfilled")
			throw new Error("Expected insertion");
		const inserted = InsertCanvasLibraryItemOutputSchema.parse(
			successful.value,
		);
		expect(inserted.groupId).toBe(inserted.rootShapeId);
		expect(Object.keys(inserted.shapeIdsByKey)).toEqual(
			libraryItem.elements.map((element) => element.key),
		);
		const read = await f.read(canvasId);
		expect(read.revision).toBe(inserted.revision);
		expect(read.shapes).toHaveLength(libraryItem.elements.length + 1);
		expect(read.bindings).toHaveLength(6);
		expect(read.history.map((version) => version.id)).toEqual([
			inserted.historyVersionId,
		]);
		expect((await f.read(canvasId, inserted.historyVersionId)).shapes).toEqual(
			before.shapes,
		);
		await f.edit(
			canvasId,
			[
				{
					op: "update",
					shapeId: inserted.shapeIdsByKey.endpoint,
					text: "Payments API",
				},
			],
			inserted.revision,
		);
		expect(
			(await f.read(canvasId)).shapes.find(
				(shape) => shape.id === inserted.shapeIdsByKey.endpoint,
			)?.text,
		).toBe("Payments API");
		const second = InsertCanvasLibraryItemOutputSchema.parse(
			await f.execute("insert_canvas_library_item", {
				...args,
				expectedRevision: (await f.read(canvasId)).revision,
			}),
		);
		expect(
			new Set([
				...Object.values(inserted.shapeIdsByKey),
				...Object.values(second.shapeIdsByKey),
			]).size,
		).toBe(libraryItem.elements.length * 2);
	} finally {
		await f.stop();
	}
});

test("library discovery is available to readers; insertion respects MCP profile, workspace membership and archived parents", async () => {
	const f = await fixture("view");
	try {
		const canvas = await f.database.repositories.canvases.create(f.scope, {
			userId: f.userId,
			pageId: f.page.id,
			title: "Library",
		});
		const before = await f.read(canvas.id);
		const args = {
			...libraryArgs,
			canvasId: canvas.id,
			expectedRevision: before.revision,
		};
		const all = SearchCanvasLibraryOutputSchema.parse(
			await f.execute("search_canvas_library", {}),
		);
		expect(all.total).toBe(CANVAS_LIBRARY_ITEMS.length);
		const page = SearchCanvasLibraryOutputSchema.parse(
			await f.execute("search_canvas_library", { limit: 2, offset: 2 }),
		);
		expect(page.items).toEqual(all.items.slice(2, 4));
		expect(page.total).toBe(all.total);
		await expect(f.execute("insert_canvas_library_item", args)).rejects.toThrow(
			"does not allow",
		);
		await expect(
			f.execute("search_canvas_library", { workspaceId: "other" }),
		).rejects.toThrow("cannot access");
		await expect(
			f.execute("search_canvas_library", { limit: 51 }),
		).rejects.toThrow();
		f.connection.permissionProfile = "edit";
		await expect(
			f.execute("insert_canvas_library_item", {
				...args,
				workspaceId: "other",
			}),
		).rejects.toThrow("cannot access");
		await f.database.repositories.pages.setDeletedByIds(
			f.scope,
			[f.page.id],
			new Date().toISOString(),
		);
		await expect(
			f.execute("insert_canvas_library_item", args),
		).rejects.toMatchObject({ code: "CANVAS_NOT_FOUND" });
		await f.database.db
			.delete(schema.member)
			.where(eq(schema.member.userId, f.userId));
		await expect(f.execute("search_canvas_library", {})).rejects.toThrow(
			"not a member",
		);
		await expect(f.execute("insert_canvas_library_item", args)).rejects.toThrow(
			"not a member",
		);
	} finally {
		await f.stop();
	}
});

test("failed library insertion commits publish no drawing or history", async () => {
	const f = await fixture();
	try {
		const { canvasId } = await f.create();
		const before = await f.read(canvasId);
		const original = f.ctx.ports.uow.transaction;
		f.ctx.ports.uow.transaction = (fn) =>
			original(async (tx) => {
				await fn(tx);
				throw new Error("Rollback insertion");
			});
		await expect(
			f.execute("insert_canvas_library_item", {
				...libraryArgs,
				canvasId,
				expectedRevision: before.revision,
			}),
		).rejects.toThrow();
		f.ctx.ports.uow.transaction = original;
		expect(await f.read(canvasId)).toEqual(before);
	} finally {
		await f.stop();
	}
});

const diagram = [
	{ op: "create", ref: "api", type: "rectangle", x: 0, y: 0, text: "API" },
	{
		op: "create",
		ref: "database",
		type: "ellipse",
		x: 400,
		y: 0,
		text: "Database",
	},
	{
		op: "connect",
		ref: "request",
		fromId: "api",
		toId: "database",
		text: "query",
	},
];

test("MCP customizes grouped drawings through the signed worker bridge with history, revisions and deletion permissions", async () => {
	const f = await fixture("edit");
	try {
		const canvas = await f.database.repositories.canvases.create(f.scope, {
			userId: f.userId,
			pageId: f.page.id,
			title: "Grouped drawing",
		});
		const initial = prepareCanvasEdit(normalizeCanvasSnapshot({}), {
			action: "edit",
			canvasId: canvas.id,
			expectedRevision: "unused",
			operations: ["a", "b", "c"].map((ref, index) => ({
				op: "create",
				ref,
				type: "rectangle",
				x: index * 300,
				y: 0,
				text: ref,
			})),
		});
		const records = initial.next.store as Record<string, TLRecord>;
		const groupId = "shape:template" as TLShape["id"];
		records[groupId] = {
			...(records[initial.createdShapes.a] as TLShape),
			id: groupId,
			type: "group",
			x: 100,
			y: 200,
			rotation: Math.PI / 4,
			props: {},
			meta: { libraryItem: "test" },
		};
		for (const id of Object.values(initial.createdShapes))
			records[id] = { ...(records[id] as TLShape), parentId: groupId };
		await f.database.repositories.canvases.initializeSnapshot(
			f.scope,
			canvas.id,
			JSON.stringify(initial.next),
		);
		const before = await f.read(canvas.id);
		const result = await f.edit(
			canvas.id,
			[
				{
					op: "update",
					shapeId: initial.createdShapes.a,
					text: "Gateway",
					x: 40,
					width: 300,
					color: "blue",
				},
				{
					op: "create",
					ref: "button",
					type: "rectangle",
					parentId: groupId,
					x: 900,
					y: 200,
					text: "Add task",
				},
				{
					op: "connect",
					ref: "link",
					fromId: initial.createdShapes.a,
					toId: "button",
				},
			],
			before.revision,
		);
		const current = await f.read(canvas.id);
		expect(
			current.shapes.find((shape) => shape.id === initial.createdShapes.a),
		).toMatchObject({
			parentId: groupId,
			text: "Gateway",
			x: 40,
			props: { w: 300, color: "blue" },
		});
		expect(
			current.shapes.find((shape) => shape.id === result.createdShapes.button),
		).toMatchObject({ parentId: groupId, text: "Add task" });
		expect(
			current.shapes.find((shape) => shape.id === result.createdShapes.link),
		).toMatchObject({ parentId: groupId });
		expect(current.shapes.find((shape) => shape.id === groupId)).toEqual(
			before.shapes.find((shape) => shape.id === groupId)!,
		);
		expect(current.bindings).toHaveLength(2);
		expect((await f.read(canvas.id, result.historyVersionId)).shapes).toEqual(
			before.shapes,
		);
		await expect(
			f.edit(
				canvas.id,
				[{ op: "update", shapeId: initial.createdShapes.a, text: "Stale" }],
				before.revision,
			),
		).rejects.toMatchObject({ code: "CANVAS_REVISION_CONFLICT" });
		await expect(
			f.edit(canvas.id, [
				{
					op: "update",
					shapeId: initial.createdShapes.a,
					text: "Must roll back",
				},
				{
					op: "create",
					ref: "bad",
					type: "text",
					parentId: "shape:missing",
					x: 0,
					y: 0,
				},
			]),
		).rejects.toMatchObject({ code: "INVALID_CANVAS_EDIT" });
		expect(await f.read(canvas.id)).toEqual(current);
		const deletion = {
			canvasId: canvas.id,
			expectedRevision: current.revision,
			shapeIds: [result.createdShapes.button, result.createdShapes.link],
		};
		await expect(f.execute("delete_canvas_shapes", deletion)).rejects.toThrow();
		f.connection.permissionProfile = "full";
		await f.execute("delete_canvas_shapes", deletion);
		const removed = await f.read(canvas.id);
		expect(removed.shapes).toHaveLength(4);
		expect(removed.bindings).toEqual([]);
		expect(removed.shapes.find((shape) => shape.id === groupId)).toBeDefined();
		await expect(
			f.execute("delete_canvas_shapes", {
				canvasId: canvas.id,
				expectedRevision: removed.revision,
				shapeIds: [initial.createdShapes.a, initial.createdShapes.b],
			}),
		).rejects.toMatchObject({ code: "INVALID_CANVAS_EDIT" });
		expect(await f.read(canvas.id)).toEqual(removed);
	} finally {
		await f.stop();
	}
});

test("MCP creates page canvas blocks, native diagrams, targeted edits and durable history through the signed bridge", async () => {
	const f = await fixture();
	try {
		const created = await f.create();
		const page = await f.readPage();
		expect(page.revision).toBe(created.revision);
		expect(page.blocks.at(-1)).toMatchObject({
			type: "canvas",
			id: created.insertedBlockIds[0],
			props: { canvasId: created.canvasId },
		});
		const edited = await f.edit(
			created.canvasId,
			diagram,
			created.canvasRevision,
		);
		const current = await f.read(created.canvasId);
		expect(current.shapes).toHaveLength(3);
		expect(current.bindings).toHaveLength(2);
		expect(
			current.shapes.find((s) => s.id === edited.createdShapes.api)?.text,
		).toBe("API");
		expect(
			(await f.read(created.canvasId, edited.historyVersionId)).shapes,
		).toEqual([]);
		const updated = await f.edit(created.canvasId, [
			{
				op: "update",
				shapeId: edited.createdShapes.api,
				x: 50,
				text: "Gateway",
				color: "blue",
			},
		]);
		expect(
			(await f.read(created.canvasId)).shapes.find(
				(s) => s.id === edited.createdShapes.api,
			),
		).toMatchObject({
			x: 50,
			text: "Gateway",
			props: { color: "blue", w: 240, h: 120 },
		});
		expect(
			(await f.read(created.canvasId, updated.historyVersionId)).shapes.find(
				(s) => s.id === edited.createdShapes.api,
			)?.text,
		).toBe("API");
		await expect(
			f.edit(created.canvasId, diagram, edited.revision),
		).rejects.toMatchObject({
			code: "CANVAS_REVISION_CONFLICT",
			details: { currentRevision: updated.revision },
		});
		const stored = await f.database.repositories.canvases.findSyncRoom(
			f.scope,
			created.canvasId,
		);
		expect(JSON.stringify(stored)).toContain("Gateway");
	} finally {
		await f.stop();
	}
});

test("invalid batches, stale page revisions and database failures leave no partial edits or orphan canvases", async () => {
	const f = await fixture();
	const original = f.ctx.ports.uow.transaction;
	try {
		const created = await f.create();
		const before = await f.read(created.canvasId);
		await expect(
			f.edit(created.canvasId, [
				...diagram,
				{ op: "update", shapeId: "shape:missing", text: "fail" },
			]),
		).rejects.toMatchObject({ code: "INVALID_CANVAS_EDIT" });
		expect(await f.read(created.canvasId)).toEqual(before);
		f.ctx.ports.uow.transaction = async () => {
			throw new Error("Storage failed");
		};
		await expect(
			f.edit(created.canvasId, diagram, before.revision),
		).rejects.toMatchObject({ code: "CANVAS_WORKER_UNAVAILABLE" });
		f.ctx.ports.uow.transaction = original;
		expect(await f.read(created.canvasId)).toEqual(before);
		f.ctx.ports.uow.transaction = (work) =>
			original((tx) =>
				work({
					...tx,
					canvases: {
						...tx.canvases,
						commitSyncRoom: async () => {
							throw new Error("Commit failed after history");
						},
					},
				}),
			);
		await expect(
			f.edit(created.canvasId, diagram, before.revision),
		).rejects.toMatchObject({ code: "CANVAS_WORKER_UNAVAILABLE" });
		f.ctx.ports.uow.transaction = (work) =>
			original((tx) =>
				work({
					...tx,
					documents: {
						...tx.documents,
						appendBlocks: async () => {
							throw new Error("Page insertion failed after canvas creation");
						},
					},
				}),
			);
		await expect(f.create()).rejects.toThrow();
		f.ctx.ports.uow.transaction = original;
		expect(await f.read(created.canvasId)).toEqual(before);
		await expect(
			f.execute("create_canvas_block", {
				pageId: f.page.id,
				expectedRevision: "stale",
			}),
		).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
		expect(await f.database.db.select().from(schema.canvases)).toHaveLength(1);
		expect(
			await f.database.db.select().from(schema.canvasHistory),
		).toHaveLength(0);
	} finally {
		f.ctx.ports.uow.transaction = original;
		await f.stop();
	}
});

test("native notes and text are editable, malformed inputs are rejected, and history is bounded", async () => {
	const f = await fixture();
	try {
		const { canvasId } = await f.create();
		const made = await f.edit(canvasId, [
			{ op: "create", ref: "note", type: "note", x: 0, y: 0, text: "Remember" },
			{
				op: "create",
				ref: "text",
				type: "text",
				x: 300,
				y: 0,
				text: "Caption",
				width: 320,
			},
			{
				op: "create",
				ref: "decision",
				type: "diamond",
				x: 600,
				y: 0,
				text: "Ready?",
			},
		]);
		expect((await f.read(canvasId)).shapes.map((s) => s.type)).toEqual([
			"note",
			"text",
			"geo",
		]);
		await expect(
			f.edit(canvasId, [
				{ op: "update", shapeId: made.createdShapes.note, width: 400 },
			]),
		).rejects.toMatchObject({ code: "INVALID_CANVAS_EDIT" });
		await expect(
			f.edit(canvasId, [
				{ op: "create", ref: "bad", type: "image", x: 0, y: 0 },
			]),
		).rejects.toThrow();
		await expect(
			f.edit(canvasId, [
				{
					op: "update",
					shapeId: made.createdShapes.text,
					text: "x".repeat(5_001),
				},
			]),
		).rejects.toThrow();
		for (let i = 0; i < 51; i++)
			await f.edit(canvasId, [
				{
					op: "update",
					shapeId: made.createdShapes.text,
					text: `Caption ${i}`,
				},
			]);
		const read = await f.read(canvasId);
		expect(read.history).toHaveLength(50);
		expect(read.history.some((v) => v.id === made.historyVersionId)).toBe(
			false,
		);
	} finally {
		await f.stop();
	}
});

test("only one of two competing MCP edits with the same revision commits", async () => {
	const f = await fixture();
	try {
		const { canvasId, canvasRevision } = await f.create();
		const results = await Promise.allSettled([
			f.edit(canvasId, diagram, canvasRevision),
			f.edit(canvasId, diagram, canvasRevision),
		]);
		expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
		expect(results.filter((r) => r.status === "rejected")[0]).toMatchObject({
			reason: { code: "CANVAS_REVISION_CONFLICT" },
		});
		expect((await f.read(canvasId)).shapes).toHaveLength(3);
	} finally {
		await f.stop();
	}
});

test("deletions preserve binding integrity and require Full access", async () => {
	const f = await fixture("edit");
	try {
		const { canvasId } = await f.create();
		const edit = await f.edit(canvasId, diagram);
		const args = {
			canvasId,
			expectedRevision: edit.revision,
			shapeIds: [edit.createdShapes.api],
		};
		await expect(f.execute("delete_canvas_shapes", args)).rejects.toThrow(
			"does not allow",
		);
		f.connection.permissionProfile = "full";
		await expect(f.execute("delete_canvas_shapes", args)).rejects.toMatchObject(
			{ code: "INVALID_CANVAS_EDIT" },
		);
		await f.execute("delete_canvas_shapes", {
			...args,
			shapeIds: [edit.createdShapes.api, edit.createdShapes.request],
		});
		const current = await f.read(canvasId);
		expect(current.shapes.map((s) => s.id)).toEqual([
			edit.createdShapes.database!,
		]);
		expect(current.bindings).toEqual([]);
	} finally {
		await f.stop();
	}
});

test("worker rejects forged or modified requests, inaccessible canvases and archived parents", async () => {
	const f = await fixture();
	try {
		const { canvasId } = await f.create();
		expect(
			(
				await f.handler(
					new Request("http://localhost/internal/canvas-command", {
						method: "POST",
						body: "{}",
					}),
				)
			).status,
		).toBe(403);
		const forged = createCanvasEditingClient({
			url: "http://localhost",
			secret: "wrong",
			fetch: (async (url, init) =>
				f.handler(new Request(url, init))) as typeof fetch,
		});
		await expect(
			forged.execute({
				userId: f.userId,
				workspaceId: f.workspaceId,
				command: { action: "read", canvasId },
			}),
		).rejects.toThrow();
		await expect(f.read(crypto.randomUUID())).rejects.toMatchObject({
			code: "CANVAS_NOT_FOUND",
		});
		await expect(
			f.execute("read_canvas", { canvasId, workspaceId: "other" }),
		).rejects.toThrow("cannot access");
		await f.database.repositories.pages.setDeletedByIds(
			f.scope,
			[f.page.id],
			new Date().toISOString(),
		);
		await expect(f.read(canvasId)).rejects.toMatchObject({
			code: "CANVAS_NOT_FOUND",
		});
		await f.database.db
			.delete(schema.member)
			.where(eq(schema.member.userId, f.userId));
		await expect(f.read(canvasId)).rejects.toThrow("not a member");
	} finally {
		await f.stop();
	}
});

test("workspace viewers cannot create or edit canvases even with Full MCP access", async () => {
	const f = await fixture("full", "viewer");
	try {
		await expect(f.create()).rejects.toThrow();
		const canvas = await f.database.repositories.canvases.create(f.scope, {
			userId: f.userId,
			pageId: null,
			title: "Existing",
		});
		expect((await f.read(canvas.id)).shapes).toEqual([]);
		await expect(f.edit(canvas.id, diagram)).rejects.toThrow();
		await expect(
			f.execute("insert_canvas_library_item", {
				...libraryArgs,
				canvasId: canvas.id,
				expectedRevision: (await f.read(canvas.id)).revision,
			}),
		).rejects.toThrow();
	} finally {
		await f.stop();
	}
});

const blankPreview = {
	pageId: "page:page",
	shapeIds: [],
	width: 1,
	height: 1,
	bounds: { x: 0, y: 0, width: 1, height: 1 },
	image: {
		mimeType: "image/png" as const,
		data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOAAAAABJRU5ErkJggg==",
	},
};

test("hosted MCP returns a native PNG and metadata without duplicating image data in text", async () => {
	const renderer = createCanvasPreviewRenderer();
	const f = await fixture("full", "owner", renderer);
	try {
		const { canvasId } = await f.create();
		const edited = InsertCanvasLibraryItemOutputSchema.parse(
			await f.execute("insert_canvas_library_item", {
				...libraryArgs,
				canvasId,
				expectedRevision: (await f.read(canvasId)).revision,
			}),
		);
		const before = await f.read(canvasId);
		const handler = createRemoteMcpRequestHandler({
			connection: f.connection,
			identity: { userId: f.userId, clientId: "client" },
			getServer: async () => f.server,
		});
		const response = await handler(
			new Request("https://haunter.test/mcp", {
				method: "POST",
				headers: {
					Accept: "application/json",
					"Content-Type": "application/json",
					"Mcp-Method": "tools/call",
					"Mcp-Name": "preview_canvas",
					"Mcp-Protocol-Version": "2026-07-28",
				},
				body: JSON.stringify({
					jsonrpc: "2.0",
					id: "preview-test",
					method: "tools/call",
					params: {
						name: "preview_canvas",
						arguments: {
							workspaceId: f.workspaceId,
							canvasId,
							expectedRevision: edited.revision,
						},
						_meta: {
							[PROTOCOL_VERSION_META_KEY]: "2026-07-28",
							[CLIENT_INFO_META_KEY]: {
								name: "Preview test",
								version: "1.0.0",
							},
							[CLIENT_CAPABILITIES_META_KEY]: {},
						},
					},
				}),
			}),
		);
		const { result, error } = await response.json();
		expect(error).toBeUndefined();
		expect(result.isError).toBeUndefined();
		expect(result.content.map((part: { type: string }) => part.type)).toEqual([
			"text",
			"image",
		]);
		expect(result.content[1].mimeType).toBe("image/png");
		const png = Buffer.from(result.content[1].data, "base64");
		expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
		expect(png.readUInt32BE(16)).toBe(result.structuredContent.width);
		expect(png.readUInt32BE(20)).toBe(result.structuredContent.height);
		expect(result.structuredContent.revision).toBe(edited.revision);
		expect(result.structuredContent.shapeIds).toHaveLength(
			libraryItem.elements.length + 1,
		);
		expect(JSON.parse(result.content[0].text)).toEqual(
			result.structuredContent,
		);
		expect(result.structuredContent.image).toBeUndefined();
		expect(await f.read(canvasId)).toEqual(before);
	} finally {
		await renderer.stop();
		await f.stop();
	}
}, 30_000);

test("View-only workspace readers can preview, but stale revisions and inaccessible canvases never render", async () => {
	let calls = 0;
	const f = await fixture("view", "viewer", {
		render: async () => {
			calls++;
			return blankPreview;
		},
	});
	try {
		const canvas = await f.database.repositories.canvases.create(f.scope, {
			userId: f.userId,
			pageId: f.page.id,
			title: "Read only",
		});
		const revision = (await f.read(canvas.id)).revision;
		const preview = CanvasPreviewOutputSchema.parse(
			await f.execute("preview_canvas", {
				canvasId: canvas.id,
				expectedRevision: revision,
			}),
		);
		expect(preview.revision).toBe(revision);
		expect(calls).toBe(1);
		await expect(
			f.execute("preview_canvas", {
				canvasId: canvas.id,
				expectedRevision: "stale",
			}),
		).rejects.toMatchObject({
			code: "CANVAS_REVISION_CONFLICT",
			details: { currentRevision: revision },
		});
		await expect(
			f.execute("preview_canvas", {
				canvasId: canvas.id,
				workspaceId: "other",
			}),
		).rejects.toThrow();
		await f.database.repositories.pages.setDeletedByIds(
			f.scope,
			[f.page.id],
			new Date().toISOString(),
		);
		await expect(
			f.execute("preview_canvas", { canvasId: canvas.id }),
		).rejects.toMatchObject({ code: "CANVAS_NOT_FOUND" });
		expect(calls).toBe(1);
	} finally {
		await f.stop();
	}
});

test("slow previews release the edit queue and preserve their captured revision and snapshot", async () => {
	const started =
		Promise.withResolvers<Parameters<CanvasPreviewRenderer["render"]>[0]>();
	const finish = Promise.withResolvers<void>();
	const f = await fixture("full", "owner", {
		render: async (input) => {
			started.resolve(input);
			await finish.promise;
			return blankPreview;
		},
	});
	try {
		const { canvasId } = await f.create();
		const before = await f.read(canvasId);
		const pending = f.execute("preview_canvas", {
			canvasId,
			expectedRevision: before.revision,
		});
		const captured = await started.promise;
		const edited = await f.edit(canvasId, diagram);
		expect(edited.revision).not.toBe(before.revision);
		expect(
			Object.values(captured.snapshot.store).filter(
				(r) => r.typeName === "shape",
			),
		).toHaveLength(0);
		finish.resolve();
		expect(CanvasPreviewOutputSchema.parse(await pending).revision).toBe(
			before.revision,
		);
		expect((await f.read(canvasId)).revision).toBe(edited.revision);
	} finally {
		finish.resolve();
		await f.stop();
	}
});

test("revoking membership during rendering prevents the captured image from returning", async () => {
	const started = Promise.withResolvers<void>();
	const finish = Promise.withResolvers<void>();
	const f = await fixture("full", "owner", {
		render: async () => {
			started.resolve();
			await finish.promise;
			return blankPreview;
		},
	});
	try {
		const { canvasId } = await f.create();
		const pending = f.execute("preview_canvas", { canvasId });
		const outcome = pending.then(
			() => null,
			(error: unknown) => error,
		);
		await started.promise;
		await f.database.db
			.delete(schema.member)
			.where(eq(schema.member.userId, f.userId));
		finish.resolve();
		expect(await outcome).toMatchObject({ code: "FORBIDDEN" });
	} finally {
		finish.resolve();
		await f.stop();
	}
});

test("a worker without preview support returns a safe unavailable error without changing the canvas", async () => {
	const f = await fixture();
	try {
		const { canvasId } = await f.create();
		const before = await f.read(canvasId);
		await expect(
			f.execute("preview_canvas", { canvasId }),
		).rejects.toMatchObject({ code: "CANVAS_PREVIEW_UNAVAILABLE" });
		expect(await f.read(canvasId)).toEqual(before);
	} finally {
		await f.stop();
	}
});

test("Agent Auth library tools require explicit workspace constraints and execute the same insertion workflow", async () => {
	const f = await fixture();
	try {
		const { canvasId, canvasRevision } = await f.create();
		const adapter = createHaunterAgentAuthAdapter(() =>
			createHaunterAgentCapabilityExecutor({ getServer: async () => f.server }),
		);
		if (!adapter.onExecute) throw new Error("Missing Agent Auth executor");
		for (const capability of [
			"search_canvas_library",
			"insert_canvas_library_item",
		]) {
			const args =
				capability === "search_canvas_library"
					? { workspaceId: f.workspaceId, query: libraryItem.id }
					: {
							...libraryArgs,
							workspaceId: f.workspaceId,
							canvasId,
							expectedRevision: canvasRevision,
						};
			await expect(
				adapter.onExecute(
					createBetterAuthAgentCapabilityTestContext({
						capability,
						arguments: args,
						constraints: null,
						agentId: "agent_test",
						userId: f.userId,
					}),
				),
			).rejects.toThrow("missing required constraints");
			const result = await adapter.onExecute(
				createBetterAuthAgentCapabilityTestContext({
					capability,
					arguments: args,
					constraints: { workspaceId: f.workspaceId },
					agentId: "agent_test",
					userId: f.userId,
				}),
			);
			if (capability === "search_canvas_library") {
				expect(SearchCanvasLibraryOutputSchema.parse(result).items[0].id).toBe(
					libraryItem.id,
				);
			} else {
				expect(
					InsertCanvasLibraryItemOutputSchema.parse(result).shapeIdsByKey
						.endpoint,
				).toStartWith("shape:");
			}
		}
		expect((await f.read(canvasId)).shapes).toHaveLength(
			libraryItem.elements.length + 1,
		);
	} finally {
		await f.stop();
	}
});

test("MCP structure edits commit one history entry, preserve bindings, and reject stale or partial writes", async () => {
	const native = createCanvasStructureEditor();
	const f = await fixture("edit", "owner", undefined, native);
	try {
		const { canvasId } = await f.create();
		const made = await f.edit(canvasId, diagram);
		const before = await f.read(canvasId);
		const result = await f.edit(
			canvasId,
			[
				{
					op: "group",
					ref: "component",
					shapeIds: [made.createdShapes.api, made.createdShapes.database],
				},
				{
					op: "create",
					ref: "frame",
					type: "frame",
					x: -100,
					y: -100,
					width: 1000,
					height: 500,
					text: "Architecture",
				},
				{ op: "reparent", shapeIds: ["component"], parentId: "frame" },
				{ op: "update", shapeId: "frame", x: 100 },
			],
			made.revision,
		);
		const after = await f.read(canvasId);
		expect(after.history).toHaveLength(before.history.length + 1);
		expect(after.bindings.map((b) => b.id).sort()).toEqual(
			before.bindings.map((b) => b.id).sort(),
		);
		expect(
			after.shapes.find((s) => s.id === made.createdShapes.request)?.parentId,
		).toBe(result.createdShapes.component);
		expect((await f.read(canvasId, result.historyVersionId)).shapes).toEqual(
			before.shapes,
		);
		await expect(
			f.edit(
				canvasId,
				[{ op: "ungroup", shapeId: result.createdShapes.component }],
				made.revision,
			),
		).rejects.toMatchObject({ code: "CANVAS_REVISION_CONFLICT" });
		await expect(
			f.edit(canvasId, [
				{
					op: "update",
					shapeId: result.createdShapes.frame,
					text: "Must roll back",
				},
				{
					op: "reparent",
					shapeIds: [result.createdShapes.frame],
					parentId: result.createdShapes.component,
				},
			]),
		).rejects.toMatchObject({ code: "INVALID_CANVAS_EDIT" });
		expect(await f.read(canvasId)).toEqual(after);
		const transaction = f.ctx.ports.uow.transaction;
		f.ctx.ports.uow.transaction = (work) =>
			transaction((tx) =>
				work({
					...tx,
					canvases: {
						...tx.canvases,
						commitSyncRoom: async () => {
							throw new Error("storage unavailable");
						},
					},
				}),
			);
		try {
			await expect(
				f.edit(canvasId, [
					{ op: "ungroup", shapeId: result.createdShapes.component },
				]),
			).rejects.toMatchObject({ code: "CANVAS_WORKER_UNAVAILABLE" });
		} finally {
			f.ctx.ports.uow.transaction = transaction;
		}
		expect(await f.read(canvasId)).toEqual(after);
		await f.edit(canvasId, [
			{ op: "ungroup", shapeId: result.createdShapes.component },
		]);
		expect(
			(await f.read(canvasId)).shapes.some(
				(s) => s.id === result.createdShapes.component,
			),
		).toBe(false);
		f.connection.permissionProfile = "view";
		await expect(
			f.edit(canvasId, [
				{ op: "update", shapeId: result.createdShapes.frame, x: 300 },
			]),
		).rejects.toThrow("does not allow");
	} finally {
		await f.stop();
		await native.stop();
	}
}, 30_000);

test("membership revoked during native preparation prevents history and document writes", async () => {
	const started = Promise.withResolvers<void>();
	const finish = Promise.withResolvers<void>();
	const f = await fixture("edit", "owner", undefined, {
		prepare: async ({ snapshot }) => {
			started.resolve();
			await finish.promise;
			return { next: snapshot, changed: [], deleted: [], createdShapes: {} };
		},
	});
	try {
		const { canvasId } = await f.create();
		const made = await f.edit(canvasId, diagram);
		const before = await f.database.db.select().from(schema.canvases);
		const history = await f.database.db.select().from(schema.canvasHistory);
		const pending = f
			.edit(canvasId, [
				{
					op: "group",
					ref: "g",
					shapeIds: [made.createdShapes.api, made.createdShapes.database],
				},
			])
			.then(
				() => null,
				(error: unknown) => error,
			);
		await started.promise;
		await f.database.db
			.delete(schema.member)
			.where(eq(schema.member.userId, f.userId));
		finish.resolve();
		expect(await pending).toMatchObject({ code: "FORBIDDEN" });
		expect(await f.database.db.select().from(schema.canvases)).toEqual(before);
		expect(await f.database.db.select().from(schema.canvasHistory)).toEqual(
			history,
		);
	} finally {
		finish.resolve();
		await f.stop();
	}
});

test("workers without native canvas organization reject it without affecting legacy edits", async () => {
	const f = await fixture("edit");
	try {
		const { canvasId } = await f.create();
		const made = await f.edit(canvasId, diagram);
		const before = await f.read(canvasId);
		await expect(
			f.edit(canvasId, [
				{
					op: "group",
					ref: "g",
					shapeIds: [made.createdShapes.api, made.createdShapes.database],
				},
			]),
		).rejects.toMatchObject({ code: "CANVAS_WORKER_UNAVAILABLE" });
		expect(await f.read(canvasId)).toEqual(before);
		await expect(
			f.edit(canvasId, [
				{ op: "group", ref: "g", shapeIds: [made.createdShapes.api] },
			]),
		).rejects.toThrow();
		await f.edit(canvasId, [
			{ op: "update", shapeId: made.createdShapes.api, text: "Still editable" },
		]);
	} finally {
		await f.stop();
	}
});

test("MCP inserts and reads native image assets through the signed worker bridge, preserving revisions and recovery", async () => {
	const f = await fixture("edit");
	try {
		const sharp = (await import("sharp")).default;
		const bytes = await sharp({
			create: { width: 60, height: 40, channels: 3, background: "#ff0055" },
		})
			.png()
			.toBuffer();
		const canvas = await f.create();
		const before = await f.read(canvas.canvasId);
		const inserted = CanvasEditOutputSchema.parse(
			await f.execute("insert_canvas_image", {
				canvasId: canvas.canvasId,
				expectedRevision: before.revision,
				x: 120,
				y: 200,
				width: 300,
				inlineFile: {
					name: "chart.png",
					mimeType: "image/png",
					data: bytes.toString("base64"),
				},
			}),
		);
		const id = inserted.createdShapes.image!;
		const after = await f.read(canvas.canvasId);
		expect(after.shapes).toHaveLength(1);
		expect(after.shapes[0]).toMatchObject({
			id,
			type: "image",
			x: 120,
			y: 200,
			props: { w: 300, h: 200 },
		});
		expect(
			(await f.read(canvas.canvasId, inserted.historyVersionId)).shapes,
		).toHaveLength(0);
		const { CanvasImageOutputSchema } = await import("../editing");
		const read = CanvasImageOutputSchema.parse(
			await f.execute("read_canvas_image", {
				canvasId: canvas.canvasId,
				shapeId: id,
				expectedRevision: inserted.revision,
			}),
		);
		expect(read).toMatchObject({
			name: "chart.png",
			width: 60,
			height: 40,
			mimeType: "image/png",
			revision: inserted.revision,
		});
		expect(
			(await sharp(Buffer.from(read.data, "base64")).raw().toBuffer()).subarray(
				0,
				3,
			),
		).toEqual(Buffer.from([255, 0, 85]));
		await expect(
			f.execute("read_canvas_image", {
				canvasId: canvas.canvasId,
				shapeId: id,
				expectedRevision: before.revision,
			}),
		).rejects.toMatchObject({ code: "CANVAS_REVISION_CONFLICT" });
		await f.edit(canvas.canvasId, [
			{ op: "update", shapeId: id, x: 250, width: 600, height: 400 },
		]);
		expect((await f.read(canvas.canvasId)).shapes[0]).toMatchObject({
			x: 250,
			props: { w: 600, h: 400, assetId: after.shapes[0]!.props.assetId },
		});
		await expect(
			f.edit(canvas.canvasId, [
				{ op: "update", shapeId: id, text: "Unsupported" },
			]),
		).rejects.toMatchObject({ code: "INVALID_CANVAS_EDIT" });
		f.connection.permissionProfile = "view";
		await expect(
			f.execute("insert_canvas_image", {
				canvasId: canvas.canvasId,
				expectedRevision: (await f.read(canvas.canvasId)).revision,
				x: 0,
				y: 0,
				inlineFile: {
					name: "chart.png",
					mimeType: "image/png",
					data: bytes.toString("base64"),
				},
			}),
		).rejects.toThrow();
		expect(
			CanvasImageOutputSchema.parse(
				await f.execute("read_canvas_image", {
					canvasId: canvas.canvasId,
					shapeId: id,
				}),
			).data,
		).toBe(read.data);
		f.connection.permissionProfile = "full";
		await f.execute("delete_canvas_shapes", {
			canvasId: canvas.canvasId,
			expectedRevision: (await f.read(canvas.canvasId)).revision,
			shapeIds: [id],
		});
		expect((await f.read(canvas.canvasId)).shapes).toHaveLength(0);
	} finally {
		await f.stop();
	}
}, 30_000);

test("native previews render image pixels and native organization handles image groups", async () => {
	const renderer = createCanvasPreviewRenderer();
	const structure = createCanvasStructureEditor();
	const f = await fixture("edit", "owner", renderer, structure);
	try {
		const sharp = (await import("sharp")).default;
		const bytes = await sharp({
			create: { width: 80, height: 60, channels: 3, background: "#ff0055" },
		})
			.png()
			.toBuffer();
		const canvas = await f.create();
		const inserted = CanvasEditOutputSchema.parse(
			await f.execute("insert_canvas_image", {
				canvasId: canvas.canvasId,
				expectedRevision: canvas.canvasRevision,
				x: 0,
				y: 0,
				inlineFile: {
					name: "chart.png",
					mimeType: "image/png",
					data: bytes.toString("base64"),
				},
			}),
		);
		const id = inserted.createdShapes.image!;
		const preview = CanvasPreviewOutputSchema.parse(
			await f.execute("preview_canvas", {
				canvasId: canvas.canvasId,
				shapeIds: [id],
			}),
		);
		const { data, info } = await sharp(
			Buffer.from(preview.image.data, "base64"),
		)
			.removeAlpha()
			.raw()
			.toBuffer({ resolveWithObject: true });
		const center =
			(Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) *
			info.channels;
		expect([...data.subarray(center, center + 3)]).toEqual([255, 0, 85]);
		const grouped = await f.edit(canvas.canvasId, [
			{ op: "create", ref: "label", type: "text", text: "Chart", x: 0, y: 100 },
			{ op: "group", ref: "chart", shapeIds: [id, "label"] },
			{ op: "update", shapeId: "chart", x: 400, y: 300 },
		]);
		expect(
			(await f.read(canvas.canvasId)).shapes.find((s) => s.id === id)?.parentId,
		).toBe(grouped.createdShapes.chart);
	} finally {
		await f.stop();
		await renderer.stop();
		await structure.stop();
	}
}, 60_000);

test("image insertion rejects stale revisions, invalid parents and revoked access without orphan assets", async () => {
	const f = await fixture("edit");
	try {
		const sharp = (await import("sharp")).default;
		const data = (
			await sharp({
				create: { width: 40, height: 30, channels: 3, background: "red" },
			})
				.png()
				.toBuffer()
		).toString("base64");
		const canvas = await f.create();
		const before = await f.read(canvas.canvasId);
		await f.edit(canvas.canvasId, [
			{ op: "create", ref: "box", type: "rectangle", x: 0, y: 0 },
		]);
		const args = {
			canvasId: canvas.canvasId,
			expectedRevision: before.revision,
			x: 10,
			y: 10,
			inlineFile: { name: "x.png", mimeType: "image/png", data },
		};
		await expect(f.execute("insert_canvas_image", args)).rejects.toMatchObject({
			code: "CANVAS_REVISION_CONFLICT",
		});
		const current = await f.read(canvas.canvasId);
		await expect(
			f.execute("insert_canvas_image", {
				...args,
				expectedRevision: current.revision,
				parentId: current.shapes[0]!.id,
			}),
		).rejects.toMatchObject({ code: "INVALID_CANVAS_EDIT" });
		const fileReader = f.ctx.ports.agentFiles.read.bind(f.ctx.ports.agentFiles);
		f.ctx.ports.agentFiles = {
			read: async (...input) => {
				const image = await fileReader(...input);
				await f.database.db.update(schema.member).set({ role: "viewer" });
				return image;
			},
		};
		await expect(
			f.execute("insert_canvas_image", {
				...args,
				expectedRevision: current.revision,
			}),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
		expect(await f.read(canvas.canvasId)).toEqual(current);
		const saved = await f.database.repositories.canvases.findById(
			f.scope,
			canvas.canvasId,
		);
		expect(JSON.stringify(saved?.snapshot)).not.toContain('"typeName":"asset"');
	} finally {
		await f.stop();
	}
});
