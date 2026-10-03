import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { createStaticAuth } from "@beignet/core/ports";
import { defineRoutes, createCsrfHooks } from "@beignet/core/server";
import { createTestApp } from "@beignet/web/testing";
import type { AppContext } from "@/app-context";
import { documentFixture } from "@/features/documents/tests/helpers";
import { openDocumentSessionUseCase } from "@/features/documents/use-cases/open-document-session";
import { documentRoutes } from "@/features/documents/routes";
import { pageRoutes } from "@/features/pages/routes";
import * as schema from "@/infra/db/schema";
import { checkDocumentAccess } from "@/infra/documents/access";
import { createDocumentSessionTokens } from "@/infra/documents/session-token";
import { appContext, type AppServiceContextInput } from "@/server/context";
import { embeddedEditorAuthHooks } from "@/server/embedded-editor-auth";
import { embeddedEditorRoutes } from "../routes";
import { authorizeEmbeddedEditorUseCase } from "../use-cases/authorize-embedded-editor";

const challenge = (secret: string) =>
	createHash("sha256").update(secret).digest("base64url");
async function fixture(
	access: "view" | "edit" = "edit",
	profile: "view" | "edit" = "edit",
) {
	const f = await documentFixture();
	f.ctx.ports.auth = createStaticAuth(null);
	f.ctx.ports.documentSessions = createDocumentSessionTokens(
		"embedded-test-secret",
	);
	const now = new Date();
	await f.database.db.insert(schema.oauthClient).values({
		id: "embedded-oauth",
		clientId: "embedded-client",
		name: "Embedded tests",
		redirectUris: ["https://host.test/callback"],
	});
	await f.database.db.insert(schema.oauthConsent).values({
		id: "embedded-consent",
		clientId: "embedded-client",
		userId: f.userId,
		scopes: ["haunter:mcp"],
		createdAt: now,
		updatedAt: now,
	});
	const connection = await f.ctx.ports.mcpConnections.authorize({
		id: crypto.randomUUID(),
		userId: f.userId,
		clientId: "embedded-client",
		permissionProfile: profile,
		embeddedEditorAccess: access,
		workspaceIds: [f.workspaceId],
		now,
	});
	if (!connection) throw new Error("Missing connection");
	async function handoff() {
		const proofSecret = challenge(crypto.randomUUID());
		const result = await authorizeEmbeddedEditorUseCase.run({
			ctx: f.ctx,
			input: {
				clientId: "embedded-client",
				workspaceId: f.workspaceId,
				pageId: f.page.id,
				challenge: challenge(proofSecret),
			},
		});
		return { ...result, proofSecret };
	}
	async function login() {
		const grant = await handoff();
		const session = await f.ctx.ports.embeddedEditorSessions.exchange(grant);
		if (!session) throw new Error("Missing embedded session");
		return session;
	}
	return { ...f, connection, handoff, login };
}

test("handoff requires the iframe proof, is consumed once across concurrent exchanges, and stores no credential", async () => {
	const f = await fixture();
	try {
		const handoff = await f.handoff();
		expect(
			await f.ctx.ports.embeddedEditorSessions.exchange({
				...handoff,
				proofSecret: "x".repeat(43),
			}),
		).toBeNull();
		const responses = await Promise.all([
			f.ctx.ports.embeddedEditorSessions.exchange(handoff),
			f.ctx.ports.embeddedEditorSessions.exchange(handoff),
		]);
		expect(responses.filter(Boolean)).toHaveLength(1);
		const result = responses.find(Boolean);
		if (!result) throw new Error("Exchange failed");
		expect(
			await f.ctx.ports.embeddedEditorSessions.authenticate(result.token),
		).toMatchObject({ pageId: f.page.id, role: "owner" });
		expect(
			await f.ctx.ports.embeddedEditorSessions.authenticate(handoff.id),
		).toBeNull();
		expect(
			await f.ctx.ports.embeddedEditorSessions.authenticate(
				`${result.token.slice(0, -1)}!`,
			),
		).toBeNull();
		const rows = await f.database.db
			.select()
			.from(schema.embeddedEditorSession);
		expect(JSON.stringify(rows)).not.toContain(result.token);
		expect(JSON.stringify(rows)).not.toContain(handoff.proofSecret);
	} finally {
		await f.database.close();
	}
});

test("handoff expires and cannot be issued for an unapproved workspace or an unavailable page", async () => {
	const f = await fixture();
	try {
		const handoff = await f.handoff();
		await f.database.db
			.update(schema.embeddedEditorSession)
			.set({ redeemBy: new Date(0) })
			.where(eq(schema.embeddedEditorSession.id, handoff.id));
		expect(
			await f.ctx.ports.embeddedEditorSessions.exchange(handoff),
		).toBeNull();
		for (const input of [
			{ workspaceId: "foreign", pageId: f.page.id },
			{ workspaceId: f.workspaceId, pageId: crypto.randomUUID() },
		]) {
			await expect(
				authorizeEmbeddedEditorUseCase.run({
					ctx: f.ctx,
					input: {
						...input,
						clientId: f.connection.clientId,
						challenge: "x".repeat(43),
					},
				}),
			).rejects.toMatchObject({ code: "FORBIDDEN" });
		}
	} finally {
		await f.database.close();
	}
});

test("reauthorization invalidates sessions issued under the previous consent", async () => {
	const f = await fixture();
	try {
		const first = await f.login();
		await f.ctx.ports.mcpConnections.authorize({
			id: crypto.randomUUID(),
			userId: f.userId,
			clientId: f.connection.clientId,
			permissionProfile: "edit",
			embeddedEditorAccess: "edit",
			workspaceIds: [f.workspaceId],
			now: new Date(),
		});
		expect(
			await f.ctx.ports.embeddedEditorSessions.authenticate(first.token),
		).toBeNull();
		const next = await f.login();
		expect(next.identity.connectionId).toBe(first.identity.connectionId);
		expect(
			await f.ctx.ports.embeddedEditorSessions.authenticate(next.token),
		).not.toBeNull();
	} finally {
		await f.database.close();
	}
});

test("HTTP credentials work without browser auth and cannot access other pages, move pages, or gain account access", async () => {
	const f = await fixture();
	const app = await createTestApp<
		AppContext,
		AppContext["ports"],
		AppServiceContextInput
	>({
		ports: f.ctx.ports,
		context: appContext,
		hooks: [embeddedEditorAuthHooks, createCsrfHooks<AppContext>()],
		routes: defineRoutes<AppContext>([
			embeddedEditorRoutes,
			pageRoutes,
			documentRoutes,
		]),
	});
	try {
		const grant = await f.handoff();
		const exchanged = await app.fetch(
			"http://beignet.test/api/embedded-editor/exchange",
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(grant),
			},
		);
		expect(exchanged.status).toBe(200);
		const { token } = (await exchanged.json()) as { token: string };
		const request = (path: string, body?: object) =>
			app.fetch(`http://beignet.test${path}`, {
				method: body ? "PATCH" : "GET",
				headers: {
					authorization: `HaunterEmbed ${token}`,
					"content-type": "application/json",
				},
				...(body ? { body: JSON.stringify(body) } : {}),
			});
		expect((await request(`/api/pages/${f.page.id}/metadata`)).status).toBe(
			200,
		);
		expect(
			(
				await request(`/api/pages/${f.page.id}`, {
					title: "Embedded title",
					baseTitle: "Document",
				})
			).status,
		).toBe(200);
		expect(
			(await request(`/api/pages/${crypto.randomUUID()}/metadata`)).status,
		).toBe(403);
		expect(
			(
				await request(`/api/pages/${f.page.id}`, {
					parentPageId: crypto.randomUUID(),
				})
			).status,
		).toBe(403);
		expect((await request(`/api/pages/${f.page.id}`)).status).toBe(200);
		expect(
			(await request(`/api/workspaces/${f.workspaceId}/pages`)).status,
		).toBe(403);
		const wrongOrigin = await app.fetch(
			`http://beignet.test/api/pages/${f.page.id}`,
			{
				method: "PATCH",
				headers: {
					authorization: `HaunterEmbed ${token}`,
					origin: "https://evil.test",
					"content-type": "application/json",
				},
				body: JSON.stringify({ title: "Blocked" }),
			},
		);
		expect(wrongOrigin.status).toBe(403);
		const invalid = await app.fetch(
			`http://beignet.test/api/pages/${f.page.id}/metadata`,
			{ headers: { authorization: "HaunterEmbed invalid" } },
		);
		expect(invalid.status).toBe(401);
	} finally {
		await app.stop();
		await f.database.close();
	}
});

test("browser session expiry does not affect embedded auth, while membership, consent, connection and page revocation do", async () => {
	const f = await fixture();
	try {
		const result = await f.login();
		await f.database.db.delete(schema.session);
		expect(
			await f.ctx.ports.embeddedEditorSessions.authenticate(result.token),
		).not.toBeNull();
		await f.database.db
			.update(schema.member)
			.set({ role: "viewer" })
			.where(eq(schema.member.id, "document-member"));
		expect(
			await f.ctx.ports.embeddedEditorSessions.authenticate(result.token),
		).toMatchObject({ role: "viewer" });
		await f.database.db
			.update(schema.member)
			.set({ role: "owner" })
			.where(eq(schema.member.id, "document-member"));
		await f.database.db
			.update(schema.pages)
			.set({ deletedAt: new Date().toISOString() })
			.where(eq(schema.pages.id, f.page.id));
		expect(
			await f.ctx.ports.embeddedEditorSessions.authenticate(result.token),
		).toBeNull();
		await f.database.db
			.update(schema.pages)
			.set({ deletedAt: null })
			.where(eq(schema.pages.id, f.page.id));
		await f.database.db.delete(schema.oauthConsent);
		expect(
			await f.ctx.ports.embeddedEditorSessions.authenticate(result.token),
		).toBeNull();
	} finally {
		await f.database.close();
	}
});

test("read-only consent and view connections remain read-only even for a workspace owner", async () => {
	for (const [access, profile] of [
		["view", "edit"],
		["edit", "view"],
	] as const) {
		const f = await fixture(access, profile);
		const app = await createTestApp<
			AppContext,
			AppContext["ports"],
			AppServiceContextInput
		>({
			ports: f.ctx.ports,
			context: appContext,
			hooks: [embeddedEditorAuthHooks],
			routes: defineRoutes<AppContext>([pageRoutes, documentRoutes]),
		});
		try {
			const session = await f.login();
			expect(session.identity.role).toBe("viewer");
			const response = await app.fetch(
				`http://beignet.test/api/pages/${f.page.id}`,
				{
					method: "PATCH",
					headers: {
						authorization: `HaunterEmbed ${session.token}`,
						"content-type": "application/json",
					},
					body: JSON.stringify({ title: "Forbidden" }),
				},
			);
			expect(response.status).toBe(403);
			const doc = {
				...f.grant,
				sessionId: f.connection.id,
				embeddedSessionId: session.identity.id,
			};
			expect(await checkDocumentAccess(doc, f.database.db)).toBe("viewer");
		} finally {
			await app.stop();
			await f.database.close();
		}
	}
});

test("renewal keeps a stable collaboration identity and expired or revoked credentials never revive on reconnect", async () => {
	const f = await fixture();
	try {
		const first = await f.login();
		const second = await f.login();
		f.ctx.embeddedEditor = second.identity;
		const doc = await openDocumentSessionUseCase.run({
			ctx: f.ctx,
			input: { id: f.page.id },
		});
		const grant = createDocumentSessionTokens("embedded-test-secret").verify(
			doc.token,
		);
		expect(grant.sessionId).toBe(f.connection.id);
		expect(first.identity.connectionId).toBe(second.identity.connectionId);
		expect(grant.embeddedSessionId).toBe(second.identity.id);
		expect(await checkDocumentAccess(grant, f.database.db)).toBe("owner");
		await expect(
			checkDocumentAccess(
				{ ...grant, pageId: crypto.randomUUID() },
				f.database.db,
			),
		).rejects.toThrow();
		await expect(
			checkDocumentAccess({ ...grant, kind: "canvas" }, f.database.db),
		).rejects.toThrow();
		await f.database.db
			.update(schema.embeddedEditorSession)
			.set({ expiresAt: new Date(0) })
			.where(eq(schema.embeddedEditorSession.id, first.identity.id));
		expect(
			await f.ctx.ports.embeddedEditorSessions.authenticate(first.token),
		).toBeNull();
		await f.ctx.ports.mcpConnections.disconnectOwned(
			f.userId,
			f.connection.id,
			new Date(),
		);
		expect(
			await f.ctx.ports.embeddedEditorSessions.authenticate(second.token),
		).toBeNull();
		await expect(checkDocumentAccess(grant, f.database.db)).rejects.toThrow();
		await f.ctx.ports.mcpConnections.authorize({
			id: crypto.randomUUID(),
			userId: f.userId,
			clientId: f.connection.clientId,
			permissionProfile: "edit",
			embeddedEditorAccess: "edit",
			workspaceIds: [f.workspaceId],
			now: new Date(),
		});
		expect(
			await f.ctx.ports.embeddedEditorSessions.authenticate(second.token),
		).toBeNull();
	} finally {
		await f.database.close();
	}
});
