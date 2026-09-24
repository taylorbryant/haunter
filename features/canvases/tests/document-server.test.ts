import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TLSyncClient } from "@tldraw/sync-core";
import {
	atom,
	computed,
	createTLStore,
	defaultShapeUtils,
	defaultBindingUtils,
	type TLRecord,
	type TLPage,
} from "tldraw";
import { AuthenticatedCanvasSocket } from "../client/authenticated-socket";
import { documentFixture } from "@/features/documents/tests/helpers";
import { checkDocumentAccess } from "@/infra/documents/access";
import { createCanvasSyncServer } from "@/infra/canvases/sync-server";
import { createDocumentServer } from "@/infra/documents/hocuspocus";
import {
	listenDocumentServer,
	stopDocumentServer,
} from "@/infra/documents/bun-transport";
import { createDocumentSessionTokens } from "@/infra/documents/session-token";
import { createDocumentMaintenance } from "@/infra/documents/migration";
import * as schema from "@/infra/db/schema";
import { projectCanvasRoom, canvasFingerprint } from "../lib/document";
import { CanvasEditOutputSchema, CanvasReadOutputSchema } from "../editing";
async function until(condition: () => boolean | Promise<boolean>) {
	const deadline = Date.now() + 8000;
	while (!(await condition())) {
		if (Date.now() > deadline) throw new Error("Canvas sync timed out");
		await new Promise((r) => setTimeout(r, 20));
	}
}
async function harness(role = "owner") {
	const f = await documentFixture(role);
	const canvas = await f.database.repositories.canvases.create(f.scope, {
		userId: f.userId,
		pageId: null,
		title: "Test canvas",
	});
	const tokens = createDocumentSessionTokens(
		"canvas-test-secret-at-least-32-characters",
	);
	const grant = { ...f.grant, kind: "canvas" as const, pageId: canvas.id };
	const options = {
		verify: tokens.verify,
		authorize: async (g: Parameters<typeof checkDocumentAccess>[0]) => ({
			ctx: f.ctx,
			role: await checkDocumentAccess(g, f.database.db),
		}),
	};
	const pages = createDocumentServer({
		...options,
		origin: "http://localhost:3000",
	});
	let engine = createCanvasSyncServer(options);
	let transport = listenDocumentServer(pages, {
		canvases: engine,
		port: 0,
		hostname: "127.0.0.1",
		origin: "http://localhost:3000",
	});
	const cleanup: (() => void)[] = [];
	function client() {
		let online = true,
			loaded = false,
			readonly = false;
		const receipts: string[] = [];
		const socket = new AuthenticatedCanvasSocket(async () => {
			if (!online) throw new Error("offline");
			return `ws://127.0.0.1:${transport.port}/canvas/${canvas.id}?token=${tokens.issue(grant).token}`;
		});
		const store = createTLStore({
			shapeUtils: defaultShapeUtils,
			bindingUtils: defaultBindingUtils,
		});
		const sync = new TLSyncClient({
			store,
			socket,
			presence: atom<TLRecord | null>("presence", null),
			onLoad: () => {
				loaded = true;
			},
			onAfterConnect: (_client, details) => {
				readonly = details.isReadonly;
			},
			onSyncError: (reason) => {
				throw new Error(reason);
			},
			onCustomMessageReceived: (msg) => {
				if (msg && typeof msg === "object" && "fingerprint" in msg)
					receipts.push(String(msg.fingerprint));
			},
		});
		const result = {
			store,
			socket,
			sync,
			receipts,
			get loaded() {
				return loaded;
			},
			get readonly() {
				return readonly;
			},
			offline() {
				online = false;
				socket.restart();
			},
			online() {
				online = true;
				socket.restart();
			},
		};
		cleanup.push(() => {
			sync.close();
			socket.close();
		});
		return result;
	}
	return {
		...f,
		canvas,
		tokens,
		grant,
		engine,
		transport,
		client,
		async restart() {
			await engine.stop();
			await transport.stop(true);
			engine = createCanvasSyncServer(options);
			transport = listenDocumentServer(pages, {
				canvases: engine,
				port: 0,
				hostname: "127.0.0.1",
				origin: "http://localhost:3000",
			});
		},
		async stop() {
			for (const close of cleanup) close();
			await engine.stop();
			await stopDocumentServer(pages);
			await transport.stop(true);
			await f.database.close();
		},
	};
}
const pageId = "page:page" as TLPage["id"];
function rename(
	c: ReturnType<Awaited<ReturnType<typeof harness>>["client"]>,
	name: string,
) {
	c.store.put([{ ...c.store.get(pageId)!, name }]);
}

test("agent edits reach live clients, preserve offline additions, and survive a worker restart", async () => {
	const h = await harness();
	try {
		const a = h.client(),
			b = h.client();
		await until(() => a.loaded && b.loaded);
		const read = () =>
			h.engine
				.execute(h.ctx, { action: "read", canvasId: h.canvas.id })
				.then((v) => CanvasReadOutputSchema.parse(v));
		const first = CanvasEditOutputSchema.parse(
			await h.engine.execute(h.ctx, {
				action: "edit",
				canvasId: h.canvas.id,
				expectedRevision: (await read()).revision,
				operations: [
					{
						op: "create",
						ref: "api",
						type: "rectangle",
						x: 0,
						y: 0,
						text: "API",
					},
					{ op: "create", ref: "db", type: "rectangle", x: 400, y: 0 },
					{ op: "connect", ref: "arrow", fromId: "api", toId: "db" },
				],
			}),
		);
		const shapeId = first.createdShapes.api as TLRecord["id"];
		await until(() => !!a.store.get(shapeId) && !!b.store.get(shapeId));
		a.offline();
		const offlineId = "shape:offline" as TLRecord["id"];
		const original = a.store.get(shapeId)!;
		a.store.put([{ ...original, id: offlineId, x: 800 } as TLRecord]);
		await h.engine.execute(h.ctx, {
			action: "edit",
			canvasId: h.canvas.id,
			expectedRevision: (await read()).revision,
			operations: [{ op: "update", shapeId, text: "Gateway", x: 50 }],
		});
		a.online();
		await until(
			() =>
				!!b.store.get(offlineId) &&
				JSON.stringify(a.store.get(shapeId)).includes("Gateway"),
		);
		await h.engine.flush();
		expect(a.store.getStoreSnapshot()).toEqual(b.store.getStoreSnapshot());
		a.socket.close();
		b.socket.close();
		await h.restart();
		const reloaded = h.client();
		await until(() => reloaded.loaded);
		expect(reloaded.store.get(offlineId)).toBeDefined();
		expect(JSON.stringify(reloaded.store.get(shapeId))).toContain("Gateway");
	} finally {
		await h.stop();
	}
}, 20000);

test("browser updates arriving during an agent SQL commit apply after that batch without being lost", async () => {
	const h = await harness();
	const original = h.ctx.ports.uow.transaction;
	let release: () => void = () => {};
	try {
		const a = h.client();
		await until(() => a.loaded);
		const before = CanvasReadOutputSchema.parse(
			await h.engine.execute(h.ctx, { action: "read", canvasId: h.canvas.id }),
		);
		let entered = false;
		const blocked = new Promise<void>((resolve) => {
			release = resolve;
		});
		h.ctx.ports.uow.transaction = async (work) => {
			entered = true;
			await blocked;
			return original(work);
		};
		const edit = h.engine.execute(h.ctx, {
			action: "edit",
			canvasId: h.canvas.id,
			expectedRevision: before.revision,
			operations: [
				{ op: "create", ref: "node", type: "rectangle", x: 0, y: 0 },
			],
		});
		await until(() => entered);
		rename(a, "During agent commit");
		release();
		const result = CanvasEditOutputSchema.parse(await edit);
		await until(
			() => !!a.store.get(result.createdShapes.node as TLRecord["id"]),
		);
		await until(async () =>
			JSON.stringify(
				(await h.database.repositories.canvases.findById(h.scope, h.canvas.id))
					?.snapshot,
			).includes("During agent commit"),
		);
		expect(a.store.get(pageId)?.name).toBe("During agent commit");
	} finally {
		release();
		h.ctx.ports.uow.transaction = original;
		await h.stop();
	}
}, 15000);

test("first-party clients sync, retain offline edits, and acknowledge durable database projections", async () => {
	const h = await harness();
	try {
		const a = h.client(),
			b = h.client();
		await until(() => a.loaded && b.loaded);
		const status = computed(
			"test connection status",
			() => a.socket.connectionStatus,
		);
		expect(status.get()).toBe("online");
		a.offline();
		expect(status.get()).toBe("offline");
		rename(a, "Offline drawing");
		b.store.put([
			{
				...b.store.get("document:document" as TLRecord["id"])!,
				name: "Online document",
			} as TLRecord,
		]);
		a.online();
		await until(() => b.store.get(pageId)?.name === "Offline drawing");
		await until(async () =>
			a.receipts.includes(await canvasFingerprint(a.store.getStoreSnapshot())),
		);
		expect(a.store.getStoreSnapshot()).toEqual(b.store.getStoreSnapshot());
		const stored = await h.database.repositories.canvases.findSyncRoom(
			h.scope,
			h.canvas.id,
		);
		expect(projectCanvasRoom(JSON.parse(stored!.roomJson))).toEqual(
			a.store.getStoreSnapshot(),
		);
		expect(
			(await h.database.repositories.canvases.findById(h.scope, h.canvas.id))!
				.snapshot,
		).toEqual({ ...a.store.getStoreSnapshot() });
		a.socket.close();
		b.socket.close();
		await h.restart();
		const reloaded = h.client();
		await until(() => reloaded.loaded);
		expect(reloaded.store.get(pageId)?.name).toBe("Offline drawing");
	} finally {
		await h.stop();
	}
}, 20000);

test("read-only sessions reject edits and wrong-resource tokens", async () => {
	const h = await harness("viewer");
	try {
		const a = h.client();
		await until(() => a.loaded);
		expect(a.readonly).toBe(true);
		rename(a, "Forbidden edit");
		a.socket.sendMessage({ type: "ping" });
		await until(() => a.receipts.length > 1);
		expect(
			JSON.stringify(
				(await h.database.repositories.canvases.findById(h.scope, h.canvas.id))!
					.snapshot,
			),
		).not.toContain("Forbidden edit");
		const [payload, encodedSignature] = h.tokens
			.issue(h.grant)
			.token.split(".");
		const signature = Buffer.from(encodedSignature!, "base64url");
		// Changing the last base64url character can affect only unused padding bits.
		signature[0] = signature[0]! ^ 1;
		const tamperedToken = `${payload}.${signature.toString("base64url")}`;
		await expect(
			h.engine.prepare(
				new Request(
					`http://localhost/canvas/${h.canvas.id}?token=${tamperedToken}`,
				),
			),
		).rejects.toThrow();
		await expect(
			h.engine.prepare(
				new Request(
					`http://localhost/canvas/${h.canvas.id}?token=${h.tokens.issue({ ...h.grant, kind: "page" }).token}`,
				),
			),
		).rejects.toThrow();
	} finally {
		await h.stop();
	}
}, 15000);

test("canvas grants are resource-bound and revoke access for trashed parents, expired sessions and removed members", async () => {
	const f = await documentFixture();
	const canvas = await f.database.repositories.canvases.create(f.scope, {
		userId: f.userId,
		pageId: f.page.id,
		title: null,
	});
	const grant = { ...f.grant, kind: "canvas" as const, pageId: canvas.id };
	try {
		expect(await checkDocumentAccess(grant, f.database.db)).toBe("owner");
		await expect(
			checkDocumentAccess({ ...grant, workspaceId: "other" }, f.database.db),
		).rejects.toThrow();
		await expect(
			checkDocumentAccess({ ...grant, kind: "page" }, f.database.db),
		).rejects.toThrow();
		await f.database.repositories.pages.setDeletedByIds(
			f.scope,
			[f.page.id],
			new Date().toISOString(),
		);
		await expect(checkDocumentAccess(grant, f.database.db)).rejects.toThrow();
		await f.database.repositories.pages.setDeletedByIds(
			f.scope,
			[f.page.id],
			null,
		);
		await f.database.db.update(schema.member).set({ role: "viewer" });
		expect(await checkDocumentAccess(grant, f.database.db)).toBe("viewer");
		await f.database.db.update(schema.session).set({ expiresAt: new Date(0) });
		await expect(checkDocumentAccess(grant, f.database.db)).rejects.toThrow();
		await f.database.db
			.update(schema.session)
			.set({ expiresAt: new Date(Date.now() + 60000) });
		await f.database.db.delete(schema.member);
		await expect(checkDocumentAccess(grant, f.database.db)).rejects.toThrow();
	} finally {
		await f.database.close();
	}
});

test("canvas cutover backs up snapshots and preserves native room clocks on rerun", async () => {
	const f = await documentFixture();
	const backupPath = join(
		tmpdir(),
		`haunter-canvas-migration-${crypto.randomUUID()}.json`,
	);
	try {
		const canvas = await f.database.repositories.canvases.create(f.scope, {
			userId: f.userId,
			pageId: null,
			title: "Old drawing",
		});
		await f.database.db.delete(schema.canvasSyncRooms);
		const before = (await f.database.repositories.canvases.findById(
			f.scope,
			canvas.id,
		))!.snapshot;
		const maintenance = createDocumentMaintenance(
			f.database.db,
			`file:${f.database.path}`,
		);
		expect(await maintenance.migrate({ dryRun: true })).toMatchObject({
			canvases: 1,
			canvasesConverted: 1,
		});
		await maintenance.migrate({
			dryRun: false,
			expectedDatabase: `file:${f.database.path}`,
			backupPath,
		});
		expect(
			JSON.parse(await readFile(backupPath, "utf8")).canvases[0].snapshot,
		).toBe(JSON.stringify(before));
		const first = await f.database.repositories.canvases.findSyncRoom(
			f.scope,
			canvas.id,
		);
		expect(await maintenance.migrate({ dryRun: true })).toMatchObject({
			canvasesConverted: 0,
		});
		expect(
			await f.database.repositories.canvases.findSyncRoom(f.scope, canvas.id),
		).toEqual(first);
		await f.database.db
			.update(schema.canvases)
			.set({ snapshot: '{"bad":true}' })
			.where(eq(schema.canvases.id, canvas.id));
		await expect(maintenance.migrate({ dryRun: true })).rejects.toThrow(
			"preflight failed",
		);
	} finally {
		await rm(backupPath, { force: true });
		await f.database.close();
	}
});

test("snapshot recovery creates a separate native room", async () => {
	const h = await harness();
	try {
		const { importRecoveryUseCase } = await import(
			"@/features/documents/use-cases/import-recovery"
		);
		const before = (await h.database.repositories.canvases.findById(
			h.scope,
			h.canvas.id,
		))!.snapshot;
		const result = await importRecoveryUseCase.run({
			ctx: h.ctx,
			input: {
				workspaceId: h.workspaceId,
				filename: "drawing.json",
				file: JSON.stringify({
					format: "haunter-draft-recovery",
					version: 1,
					pages: [],
					canvases: [{ id: "old", snapshot: before }],
				}),
			},
		});
		expect(result.canvasIds[0]).not.toBe(h.canvas.id);
		const room = await h.database.repositories.canvases.findSyncRoom(
			h.scope,
			result.canvasIds[0]!,
		);
		expect(before).toEqual({
			...projectCanvasRoom(JSON.parse(room!.roomJson)),
		});
	} finally {
		await h.stop();
	}
});

test("database failures never acknowledge edits; reconnect persists the retained native queue", async () => {
	const h = await harness();
	const original = h.ctx.ports.uow.transaction;
	let fail = false;
	h.ctx.ports.uow.transaction = async (work) => {
		if (fail) throw new Error("Test storage failure");
		return original(work);
	};
	try {
		const a = h.client();
		await until(() => a.loaded);
		fail = true;
		rename(a, "Retained after storage failure");
		const expected = await canvasFingerprint(a.store.getStoreSnapshot());
		await until(() => a.socket.connectionStatus === "offline");
		expect(a.receipts).not.toContain(expected);
		expect(
			JSON.stringify(
				(await h.database.repositories.canvases.findById(h.scope, h.canvas.id))!
					.snapshot,
			),
		).not.toContain("Retained after storage failure");
		fail = false;
		a.socket.restart();
		await until(() => a.receipts.includes(expected));
		expect(
			JSON.stringify(
				(await h.database.repositories.canvases.findById(h.scope, h.canvas.id))!
					.snapshot,
			),
		).toContain("Retained after storage failure");
	} finally {
		fail = false;
		await h.stop();
	}
}, 20000);

test("deleting a dirty canvas releases its room without blocking shutdown or recreating it", async () => {
	const h = await harness();
	const original = h.ctx.ports.uow.transaction;
	let fail = true;
	h.ctx.ports.uow.transaction = async (work) => {
		if (fail) throw new Error("Storage unavailable");
		return original(work);
	};
	try {
		const a = h.client();
		await until(() => a.loaded);
		rename(a, "Deleted pending drawing");
		await until(() => a.socket.connectionStatus === "offline");
		await h.database.repositories.canvases.delete(h.scope, h.canvas.id);
		await h.engine.flush();
		expect(
			await h.database.repositories.canvases.findSyncRoom(h.scope, h.canvas.id),
		).toBeNull();
	} finally {
		fail = false;
		await h.stop();
	}
}, 15000);
