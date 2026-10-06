import { expect, test } from "bun:test";
import { defineRoutes } from "@beignet/core/server";
import { createTestApp } from "@beignet/web/testing";
import { eq } from "drizzle-orm";
import type { AppContext } from "@/app-context";
import { canvasRoutes } from "@/features/canvases/routes";
import { documentRoutes } from "@/features/documents/routes";
import { openCanvasSessionUseCase } from "@/features/documents/use-cases/open-canvas-session";
import { pageRoutes } from "@/features/pages/routes";
import * as schema from "@/infra/db/schema";
import { checkDocumentAccess } from "@/infra/documents/access";
import { createDocumentSessionTokens } from "@/infra/documents/session-token";
import { appContext, type AppServiceContextInput } from "@/server/context";
import { embeddedEditorAuthHooks } from "@/server/embedded-editor-auth";
import { EmbeddedEditorAuthorizationSchema } from "../embedded-editor-session";
import { authorizeEmbeddedEditorUseCase } from "../use-cases/authorize-embedded-editor";
import { embeddedEditorFixture } from "./embedded-editor-fixture";

async function fixture(access: "view" | "edit" = "edit") {
	const f = await embeddedEditorFixture(access);
	const canvas = await f.ctx.ports.canvases.create(f.scope, {
		userId: f.userId,
		pageId: f.page.id,
		title: null,
	});
	const standalone = await f.ctx.ports.canvases.create(f.scope, {
		userId: f.userId,
		pageId: null,
		title: "Architecture",
	});
	return { ...f, canvas, standalone };
}

test.each(["view", "edit"] as const)(
	"%s page credentials allow only their own inline canvases and recheck the relationship",
	async (access) => {
		const f = await fixture(access);
		const app = await createTestApp<
			AppContext,
			AppContext["ports"],
			AppServiceContextInput
		>({
			ports: f.ctx.ports,
			context: appContext,
			hooks: [embeddedEditorAuthHooks],
			routes: defineRoutes<AppContext>([
				canvasRoutes,
				pageRoutes,
				documentRoutes,
			]),
		});
		try {
			const other = await f.ctx.ports.pages.create(f.scope, {
				userId: f.userId,
				title: "Other",
				parentPageId: null,
				position: 1,
			});
			const otherCanvas = await f.ctx.ports.canvases.create(f.scope, {
				userId: f.userId,
				pageId: other.id,
				title: null,
			});
			const session = await f.login();
			const request = (id: string, suffix = "", method = "GET") =>
				app.fetch(`http://beignet.test/api/canvases/${id}${suffix}`, {
					method,
					headers: {
						authorization: `HaunterEmbed ${session.token}`,
						"content-type": "application/json",
					},
					...(method === "POST" ? { body: "{}" } : {}),
				});
			expect((await request(f.canvas.id)).status).toBe(200);
			expect((await request(f.canvas.id, "/sync-session", "POST")).status).toBe(
				200,
			);
			for (const id of [f.standalone.id, otherCanvas.id, crypto.randomUUID()]) {
				expect((await request(id)).status).toBe(403);
				expect((await request(id, "/sync-session", "POST")).status).toBe(403);
			}
			f.ctx.embeddedEditor = session.identity;
			const issued = await openCanvasSessionUseCase.run({
				ctx: f.ctx,
				input: { id: f.canvas.id },
			});
			const grant = createDocumentSessionTokens("embedded-test-secret").verify(
				issued.token,
			);
			expect(await checkDocumentAccess(grant, f.database.db)).toBe(
				access === "edit" ? "owner" : "viewer",
			);
			await expect(
				checkDocumentAccess(
					{ ...grant, workspaceId: "other-workspace" },
					f.database.db,
				),
			).rejects.toThrow();
			await expect(
				openCanvasSessionUseCase.run({
					ctx: f.ctx,
					input: { id: otherCanvas.id },
				}),
			).rejects.toMatchObject({ code: "FORBIDDEN" });
			// Even an already-issued collaboration token loses access when the canvas moves.
			await f.database.db
				.update(schema.canvases)
				.set({ pageId: other.id })
				.where(eq(schema.canvases.id, f.canvas.id));
			expect((await request(f.canvas.id)).status).toBe(403);
			await expect(checkDocumentAccess(grant, f.database.db)).rejects.toThrow();
			await f.database.db
				.update(schema.canvases)
				.set({ pageId: f.page.id })
				.where(eq(schema.canvases.id, f.canvas.id));
			expect(await checkDocumentAccess(grant, f.database.db)).toBe(
				access === "edit" ? "owner" : "viewer",
			);
			await f.ctx.ports.mcpConnections.disconnectOwned(
				f.userId,
				f.connection.id,
				new Date(),
			);
			await expect(checkDocumentAccess(grant, f.database.db)).rejects.toThrow();
		} finally {
			await app.stop();
			await f.database.close();
		}
	},
);

test("canvas credentials authorize exactly one resource, including standalone canvases, without web cookies", async () => {
	const f = await fixture();
	const app = await createTestApp<
		AppContext,
		AppContext["ports"],
		AppServiceContextInput
	>({
		ports: f.ctx.ports,
		context: appContext,
		hooks: [embeddedEditorAuthHooks],
		routes: defineRoutes<AppContext>([
			canvasRoutes,
			pageRoutes,
			documentRoutes,
		]),
	});
	try {
		for (const canvas of [f.canvas, f.standalone]) {
			const session = await f.login({ canvasId: canvas.id });
			expect(session.identity).toMatchObject({
				canvasId: canvas.id,
				pageId: null,
				role: "owner",
			});
			const request = (path: string, method = "GET", body?: object) =>
				app.fetch(`http://beignet.test${path}`, {
					method,
					headers: {
						authorization: `HaunterEmbed ${session.token}`,
						"content-type": "application/json",
					},
					...(body ? { body: JSON.stringify(body) } : {}),
				});
			expect((await request(`/api/canvases/${canvas.id}`)).status).toBe(200);
			expect(
				(await request(`/api/canvases/${crypto.randomUUID()}`)).status,
			).toBe(403);
			expect((await request(`/api/pages/${f.page.id}`)).status).toBe(403);
			expect(
				(
					await request(`/api/canvases/${canvas.id}`, "PATCH", {
						title: "Forbidden",
					})
				).status,
			).toBe(403);
			f.ctx.embeddedEditor = session.identity;
			const ctx = f.ctx;
			const issued = await openCanvasSessionUseCase.run({
				ctx,
				input: { id: canvas.id },
			});
			const grant = createDocumentSessionTokens("embedded-test-secret").verify(
				issued.token,
			);
			expect(grant).toMatchObject({
				kind: "canvas",
				pageId: canvas.id,
				embeddedSessionId: session.identity.id,
				sessionId: f.connection.id,
			});
			expect(await checkDocumentAccess(grant, f.database.db)).toBe("owner");
			await expect(
				checkDocumentAccess({ ...grant, kind: "page" }, f.database.db),
			).rejects.toThrow();
			await expect(
				checkDocumentAccess(
					{ ...grant, pageId: crypto.randomUUID() },
					f.database.db,
				),
			).rejects.toThrow();
			await expect(
				openCanvasSessionUseCase.run({
					ctx,
					input: {
						id: canvas.id === f.canvas.id ? f.standalone.id : f.canvas.id,
					},
				}),
			).rejects.toMatchObject({ code: "FORBIDDEN" });
		}
	} finally {
		await app.stop();
		await f.database.close();
	}
});

test("canvas sessions require fresh approval, exact targets, live membership and an available parent page", async () => {
	const f = await fixture();
	try {
		const base = { workspaceId: f.workspaceId, challenge: "x".repeat(43) };
		expect(
			EmbeddedEditorAuthorizationSchema.safeParse(base).success,
		).toBeFalse();
		expect(
			EmbeddedEditorAuthorizationSchema.safeParse({
				...base,
				pageId: f.page.id,
				canvasId: f.canvas.id,
			}).success,
		).toBeFalse();
		for (const target of [
			{ workspaceId: "other", canvasId: f.canvas.id },
			{ workspaceId: f.workspaceId, canvasId: crypto.randomUUID() },
		]) {
			await expect(
				authorizeEmbeddedEditorUseCase.run({
					ctx: f.ctx,
					input: { ...base, ...target, clientId: f.connection.clientId },
				}),
			).rejects.toMatchObject({ code: "FORBIDDEN" });
		}
		const session = await f.login({ canvasId: f.canvas.id });
		await f.database.db
			.update(schema.pages)
			.set({ deletedAt: new Date().toISOString() })
			.where(eq(schema.pages.id, f.page.id));
		expect(
			await f.ctx.ports.embeddedEditorSessions.authenticate(session.token),
		).toBeNull();
		await expect(f.handoff({ canvasId: f.canvas.id })).rejects.toMatchObject({
			code: "FORBIDDEN",
		});
		const standalone = await f.login({ canvasId: f.standalone.id });
		expect(
			await f.ctx.ports.embeddedEditorSessions.authenticate(standalone.token),
		).not.toBeNull();
		await f.database.db.delete(schema.oauthConsent);
		expect(
			await f.ctx.ports.embeddedEditorSessions.authenticate(standalone.token),
		).toBeNull();
	} finally {
		await f.database.close();
	}
});

test("embedded canvas collaboration stays read-only without edit consent and fails immediately after revocation", async () => {
	const f = await fixture("view");
	try {
		const session = await f.login({ canvasId: f.canvas.id });
		const issued = await openCanvasSessionUseCase.run({
			ctx: Object.assign(f.ctx, { embeddedEditor: session.identity }),
			input: { id: f.canvas.id },
		});
		const grant = createDocumentSessionTokens("embedded-test-secret").verify(
			issued.token,
		);
		expect(await checkDocumentAccess(grant, f.database.db)).toBe("viewer");
		await f.ctx.ports.mcpConnections.disconnectOwned(
			f.userId,
			f.connection.id,
			new Date(),
		);
		await expect(checkDocumentAccess(grant, f.database.db)).rejects.toThrow();
		expect(
			await checkDocumentAccess(
				{ ...f.grant, kind: "canvas", pageId: f.canvas.id, generation: 0 },
				f.database.db,
			),
		).toBe("owner");
	} finally {
		await f.database.close();
	}
});

test("the canvas worker rechecks embedded revocation on the next message without interrupting web sessions", async () => {
	const { createCanvasSyncServer } = await import(
		"@/infra/canvases/sync-server"
	);
	const f = await fixture();
	const tokens = createDocumentSessionTokens("embedded-worker-test");
	const session = await f.login({ canvasId: f.canvas.id });
	const engine = createCanvasSyncServer({
		verify: tokens.verify,
		authorize: async (grant) => ({
			ctx: f.ctx,
			role: await checkDocumentAccess(grant, f.database.db),
		}),
	});
	const connections = [];
	try {
		for (const embedded of [true, false]) {
			const grant = {
				...f.grant,
				kind: "canvas" as const,
				pageId: f.canvas.id,
				...(embedded
					? {
							sessionId: f.connection.id,
							embeddedSessionId: session.identity.id,
						}
					: {}),
			};
			const prepared = await engine.prepare(
				new Request(
					`http://localhost/canvas/${f.canvas.id}?token=${tokens.issue(grant).token}`,
				),
			);
			const connection = engine.open(prepared, {
				readyState: 1,
				send() {},
				close() {},
			});
			connections.push(connection);
			engine.message(connection, JSON.stringify({ type: "ping" }));
			await connection.incoming;
			expect(connection.closed).toBeFalse();
		}
		await f.ctx.ports.mcpConnections.disconnectOwned(
			f.userId,
			f.connection.id,
			new Date(),
		);
		for (const connection of connections) {
			engine.message(connection, JSON.stringify({ type: "ping" }));
			await connection.incoming;
		}
		expect(connections[0]?.closed).toBeTrue();
		expect(connections[1]?.closed).toBeFalse();
	} finally {
		await engine.stop();
		await f.database.close();
	}
});
