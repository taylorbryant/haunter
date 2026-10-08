import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { createTenantScope } from "@beignet/core/ports";
import { defineRoutes } from "@beignet/core/server";
import { createTestApp } from "@beignet/web/testing";
import { eq } from "drizzle-orm";
import type { AppContext } from "@/app-context";
import { canvasRoutes } from "@/features/canvases/routes";
import { documentRoutes } from "@/features/documents/routes";
import { searchRoutes } from "@/features/search/routes";
import { pageRoutes } from "@/features/pages/routes";
import * as schema from "@/infra/db/schema";
import { checkDocumentAccess } from "@/infra/documents/access";
import { createDocumentSessionTokens } from "@/infra/documents/session-token";
import { appContext, type AppServiceContextInput } from "@/server/context";
import { embeddedEditorAuthHooks } from "@/server/embedded-editor-auth";
import { embeddedEditorRoutes } from "../routes";
import { authorizeEmbeddedWorkspaceUseCase } from "../use-cases/authorize-embedded-workspace";
import { embeddedEditorFixture } from "./embedded-editor-fixture";

test.each(["view", "edit"] as const)(
	"%s workspace sessions scope ordinary HTTP routes and collaboration to approved membership",
	async (access) => {
		const f = await embeddedEditorFixture(access);
		const app = await createTestApp<
			AppContext,
			AppContext["ports"],
			AppServiceContextInput
		>({
			ports: f.ctx.ports,
			context: appContext,
			hooks: [embeddedEditorAuthHooks],
			routes: defineRoutes<AppContext>([
				pageRoutes,
				searchRoutes,
				canvasRoutes,
				documentRoutes,
				embeddedEditorRoutes,
			]),
		});
		try {
			const proofSecret = createHash("sha256")
				.update(crypto.randomUUID())
				.digest("base64url");
			const handoff = await authorizeEmbeddedWorkspaceUseCase.run({
				ctx: f.ctx,
				input: {
					workspaceId: f.workspaceId,
					clientId: "embedded-client",
					challenge: createHash("sha256")
						.update(proofSecret)
						.digest("base64url"),
				},
			});
			const session = await f.ctx.ports.embeddedEditorSessions.exchange({
				...handoff,
				proofSecret,
			});
			if (!session) throw new Error("No session");
			expect(session.identity.scope).toBe("workspace");
			const request = (
				path: string,
				method = "GET",
				body?: unknown,
				token = session.token,
			) =>
				app.fetch(`http://beignet.test${path}`, {
					method,
					headers: {
						authorization: `HaunterEmbed ${token}`,
						"content-type": "application/json",
					},
					...(body !== undefined ? { body: JSON.stringify(body) } : {}),
				});
			expect((await request("/api/embedded-editor/workspaces")).status).toBe(
				200,
			);
			expect(
				(await request(`/api/workspaces/${f.workspaceId}/pages`)).status,
			).toBe(200);
			expect((await request("/api/workspaces/other/pages")).status).toBe(403);
			const searched = await request(
				`/api/workspaces/${f.workspaceId}/search?query=Document&kind=page&limit=1`,
			);
			expect(searched.status).toBe(200);
			expect((await searched.json()).items[0]?.id).toBe(f.page.id);
			expect(
				(await request("/api/workspaces/other/search?query=Document")).status,
			).toBe(403);
			const documentSession = await f.login();
			expect(
				(
					await request(
						`/api/workspaces/${f.workspaceId}/search?query=Document`,
						"GET",
						undefined,
						documentSession.token,
					)
				).status,
			).toBe(403);
			expect(
				(
					await request(
						`/api/workspaces/${f.workspaceId}/search?query=Document&limit=100`,
					)
				).status,
			).toBe(422);

			expect(
				(
					await request("/api/pages", "POST", {
						workspaceId: "other",
						title: "Wrong workspace",
					})
				).status,
			).toBe(403);
			const created = await request("/api/pages", "POST", {
				workspaceId: f.workspaceId,
				title: "From the workspace UI",
			});
			expect(created.status).toBe(access === "edit" ? 201 : 403);
			const otherPage = await f.ctx.ports.pages.create(f.scope, {
				userId: f.userId,
				title: "Another page",
				parentPageId: null,
				position: 1,
			});
			const canvas = await f.ctx.ports.canvases.create(f.scope, {
				userId: f.userId,
				title: "Drawing",
				pageId: otherPage.id,
			});
			for (const id of [f.page.id, otherPage.id]) {
				expect((await request(`/api/pages/${id}/metadata`)).status).toBe(200);
				expect(
					(await request(`/api/pages/${id}`, "PATCH", { title: "Changed" }))
						.status,
				).toBe(access === "edit" ? 200 : 403);
			}
			const connection = await request(
				`/api/canvases/${canvas.id}/sync-session`,
				"POST",
				{},
			);
			expect(connection.status).toBe(200);
			const grant = createDocumentSessionTokens("embedded-test-secret").verify(
				(await connection.json()).token,
			);
			expect(await checkDocumentAccess(grant, f.database.db)).toBe(
				access === "edit" ? "owner" : "viewer",
			);
			await f.database.db
				.update(schema.pages)
				.set({ deletedAt: new Date().toISOString() })
				.where(eq(schema.pages.id, otherPage.id));
			await expect(checkDocumentAccess(grant, f.database.db)).rejects.toThrow();
			// Membership in an unapproved workspace does not enlarge this credential.
			await f.database.db.insert(schema.organization).values({
				id: "other",
				name: "Other",
				slug: "other",
				createdAt: new Date(),
			});
			await f.database.db.insert(schema.member).values({
				id: "other-member",
				organizationId: "other",
				userId: f.userId,
				role: "owner",
				createdAt: new Date(),
			});
			const foreign = await f.ctx.ports.pages.create(
				createTenantScope({ id: "other" }),
				{ userId: f.userId, title: "Private", parentPageId: null, position: 0 },
			);
			expect(
				(await request(`/api/pages/${foreign.id}/metadata`)).status,
			).not.toBe(200);
			await expect(
				authorizeEmbeddedWorkspaceUseCase.run({
					ctx: f.ctx,
					input: {
						workspaceId: "other",
						clientId: "embedded-client",
						challenge: proofSecret,
					},
				}),
			).rejects.toThrow();
			const list = await (
				await request("/api/embedded-editor/workspaces")
			).json();
			expect(
				list.workspaces.map((workspace: { id: string }) => workspace.id),
			).toEqual([f.workspaceId]);
			const legacy = await f.login();
			expect(
				(
					await request(
						`/api/pages/${foreign.id}/metadata`,
						"GET",
						undefined,
						legacy.token,
					)
				).status,
			).toBe(403);
			expect(
				(
					await request(
						`/api/workspaces/${f.workspaceId}/pages`,
						"GET",
						undefined,
						legacy.token,
					)
				).status,
			).toBe(403);
			await f.database.db
				.update(schema.member)
				.set({ role: "viewer" })
				.where(eq(schema.member.id, "document-member"));
			expect(
				(
					await request("/api/pages", "POST", {
						workspaceId: f.workspaceId,
						title: "After downgrade",
					})
				).status,
			).toBe(403);
			await f.database.db
				.delete(schema.oauthConsent)
				.where(eq(schema.oauthConsent.id, "embedded-consent"));
			expect((await request(`/api/pages/${f.page.id}/metadata`)).status).toBe(
				401,
			);
		} finally {
			await app.stop();
			await f.database.close();
		}
	},
);
