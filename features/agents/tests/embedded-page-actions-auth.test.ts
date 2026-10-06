import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { createTenantScope } from "@beignet/core/ports";
import { defineRoutes } from "@beignet/core/server";
import { createTestApp } from "@beignet/web/testing";
import { eq } from "drizzle-orm";
import type { AppContext } from "@/app-context";
import { documentRoutes } from "@/features/documents/routes";
import { paragraph, seedFixtureBody } from "@/features/documents/tests/helpers";
import { pageRoutes } from "@/features/pages/routes";
import { shareRoutes } from "@/features/shares/routes";
import * as schema from "@/infra/db/schema";
import { appContext, type AppServiceContextInput } from "@/server/context";
import { embeddedEditorAuthHooks } from "@/server/embedded-editor-auth";
import { authorizeEmbeddedWorkspaceUseCase } from "../use-cases/authorize-embedded-workspace";
import { embeddedEditorFixture } from "./embedded-editor-fixture";

test.each(["edit", "view"] as const)(
	"history, public links, and recovery respect %s workspace consent",
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
				documentRoutes,
				shareRoutes,
			]),
		});
		try {
			await seedFixtureBody(f, [paragraph("Current edits are kept")]);
			const checkpoint = await f.ctx.ports.pageVersions.create(f.scope, {
				pageId: f.page.id,
				title: f.page.title,
				icon: null,
				contentJson: JSON.stringify([paragraph("Earlier version")]),
				cause: "checkpoint",
				createdBy: f.userId,
			});
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
			if (!session) throw new Error("Missing workspace session");
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
						"idempotency-key": crypto.randomUUID(),
					},
					...(body === undefined ? {} : { body: JSON.stringify(body) }),
				});
			const versions = `/api/pages/${f.page.id}/versions`;
			const version = `${versions}/${checkpoint.id}`;
			const share = `/api/pages/${f.page.id}/share`;
			const recovery = {
				workspaceId: f.workspaceId,
				filename: "recovery.json",
				file: JSON.stringify({
					format: "haunter-draft-recovery",
					version: 1,
					pages: [
						{
							id: f.page.id,
							title: "Recovered notes",
							content: [paragraph("Recovered copy")],
						},
					],
					canvases: [{ id: "drawing", snapshot: {} }],
				}),
			};
			for (const path of [versions, version, share]) {
				const response = await request(path);
				expect(response.status).toBe(200);
				expect(response.headers.get("cache-control")).toBe("no-store");
			}
			const beforeSession = await (
				await request(`/api/pages/${f.page.id}/document-session`, "POST", {})
			).json();
			const restored = await request(`${version}/restore`, "POST", {});
			expect(restored.status).toBe(access === "edit" ? 200 : 403);
			if (access === "edit") {
				expect((await restored.json()).documentGeneration).toBe(
					beforeSession.generation + 1,
				);
				expect(
					JSON.stringify(
						(await f.ctx.ports.pages.findById(f.scope, f.page.id))?.content,
					),
				).toContain("Earlier version");
				const history = await f.ctx.ports.pageVersions.listMetaByPage(
					f.scope,
					f.page.id,
				);
				const saved = history.find((item) => item.cause === "restore");
				expect(saved).toBeDefined();
				expect(
					JSON.stringify(
						(await f.ctx.ports.pageVersions.findById(f.scope, saved!.id))
							?.content,
					),
				).toContain("Current edits are kept");
			}
			const published = await request(share, "POST", {});
			expect(published.status).toBe(access === "edit" ? 200 : 403);
			if (access === "edit") {
				const { token } = await published.json();
				expect(
					(await app.fetch(`http://beignet.test/api/shared/${token}`)).status,
				).toBe(200);
				expect((await request(share, "DELETE")).status).toBe(204);
				expect(
					(await app.fetch(`http://beignet.test/api/shared/${token}`)).status,
				).toBe(404);
			} else expect((await request(share, "DELETE")).status).toBe(403);
			const beforeRecovery = await f.ctx.ports.pages.findById(
				f.scope,
				f.page.id,
			);
			const recovered = await request(
				"/api/document-recoveries",
				"POST",
				recovery,
			);
			expect(recovered.status).toBe(access === "edit" ? 200 : 403);
			if (access === "edit") {
				const result = await recovered.json();
				expect(result.pages).toHaveLength(1);
				expect(result.pages[0].id).not.toBe(f.page.id);
				expect(result.canvasIds).toHaveLength(1);
			}
			expect(await f.ctx.ports.pages.findById(f.scope, f.page.id)).toEqual(
				beforeRecovery,
			);
			expect(
				(
					await request("/api/document-recoveries", "POST", {
						...recovery,
						workspaceId: "other",
					})
				).status,
			).toBe(403);

			// Being a member elsewhere does not authorize that workspace through this grant.
			await f.database.db
				.insert(schema.organization)
				.values({
					id: "other",
					name: "Other",
					slug: "other",
					createdAt: new Date(),
				});
			await f.database.db
				.insert(schema.member)
				.values({
					id: "other-member",
					organizationId: "other",
					userId: f.userId,
					role: "owner",
					createdAt: new Date(),
				});
			const foreignScope = createTenantScope({ id: "other" });
			const foreign = await f.ctx.ports.pages.create(foreignScope, {
				userId: f.userId,
				title: "Private",
				parentPageId: null,
				position: 0,
			});
			const foreignVersion = await f.ctx.ports.pageVersions.create(
				foreignScope,
				{
					pageId: foreign.id,
					title: "Private",
					icon: null,
					contentJson: "[]",
					cause: "checkpoint",
					createdBy: f.userId,
				},
			);
			for (const [path, method, body] of [
				[`/api/pages/${foreign.id}/versions`, "GET"],
				[`${versions}/${foreignVersion.id}`, "GET"],
				[`${versions}/${foreignVersion.id}/restore`, "POST", {}],
				[`/api/pages/${foreign.id}/share`, "GET"],
				[`/api/pages/${foreign.id}/share`, "POST", {}],
				[`/api/pages/${foreign.id}/share`, "DELETE"],
			] as const)
				expect((await request(path, method, body)).status).toBe(
					access === "view" && method !== "GET" ? 403 : 404,
				);

			const legacy = await f.login();
			for (const [path, method, body] of [
				[versions, "GET"],
				[version, "GET"],
				[`${version}/restore`, "POST", {}],
				[share, "GET"],
				[share, "POST", {}],
				[share, "DELETE"],
				["/api/document-recoveries", "POST", recovery],
			] as const)
				expect((await request(path, method, body, legacy.token)).status).toBe(
					403,
				);
			await f.database.db
				.update(schema.member)
				.set({ role: "viewer" })
				.where(eq(schema.member.id, "document-member"));
			for (const [path, body] of [
				[`${version}/restore`, {}],
				[share, {}],
				["/api/document-recoveries", recovery],
			] as const)
				expect((await request(path, "POST", body)).status).toBe(403);
			await f.database.db
				.delete(schema.oauthConsent)
				.where(eq(schema.oauthConsent.id, "embedded-consent"));
			expect((await request(versions)).status).toBe(401);
		} finally {
			await app.stop();
			await f.database.close();
		}
	},
);
