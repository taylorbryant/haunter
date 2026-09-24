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
import { executeRemoteMcpCapability } from "@/server/agent-capabilities";
import * as schema from "@/infra/db/schema";
import { CanvasReadOutputSchema, CanvasEditOutputSchema } from "../editing";
import { createCanvasBlockUseCase } from "../use-cases/create-canvas-block";

async function fixture(
	profile: McpConnectionRow["permissionProfile"] = "full",
	role = "owner",
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
		async stop() {
			await engine.stop();
			await transport.stop(true);
			await f.database.close();
		},
	};
}

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
	} finally {
		await f.stop();
	}
});
