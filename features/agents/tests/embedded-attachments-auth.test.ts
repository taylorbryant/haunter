import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { createMemoryStorage } from "@beignet/core/ports";
import { createUploadRouter } from "@beignet/core/uploads";
import { createTestApp } from "@beignet/web/testing";
import type { AppContext } from "@/app-context";
import { AttachmentUpload } from "@/features/pages/uploads";
import { canReadAttachment } from "@/features/pages/lib/attachment-access";
import * as schema from "@/infra/db/schema";
import { appContext, type AppServiceContextInput } from "@/server/context";
import { embeddedEditorAuthHooks } from "@/server/embedded-editor-auth";
import { authorizeEmbeddedWorkspaceUseCase } from "../use-cases/authorize-embedded-workspace";
import { embeddedEditorFixture } from "./embedded-editor-fixture";

test.each(["edit", "view"] as const)(
	"attachment multipart HTTP respects %s consent, source pages, and revocation",
	async (access) => {
		const f = await embeddedEditorFixture(access);
		f.ctx.ports.storage = createMemoryStorage();
		const app = await createTestApp<
			AppContext,
			AppContext["ports"],
			AppServiceContextInput
		>({
			ports: f.ctx.ports,
			context: appContext,
			hooks: [embeddedEditorAuthHooks],
			routes: [],
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
			if (!session) throw new Error("Missing session");
			const upload = (req: Request) =>
				app.server
					.rawRoute({
						name: "uploads",
						method: "POST",
						path: "/api/uploads/:uploadName/:action",
					})
					.handle(async ({ ctx }) =>
						createUploadRouter({
							uploads: [AttachmentUpload],
							ctx,
							storage: ctx.ports.storage,
						}).handleRequest(req, {
							uploadName: "pages.attachment",
							action: "upload",
						}),
					)(req);
			const request = (
				pageId = f.page.id,
				type = "text/plain",
				token = session.token,
				action = "upload",
			) => {
				const body = new FormData();
				body.set("metadata", JSON.stringify({ pageId }));
				body.set(
					"file",
					new File(
						["Private notes"],
						type === "text/html" ? "notes.html" : "notes.txt",
						{ type },
					),
				);
				return upload(
					new Request(
						`http://beignet.test/api/uploads/pages.attachment/${action}`,
						{
							method: "POST",
							headers: { authorization: `HaunterEmbed ${token}` },
							body,
						},
					),
				);
			};
			expect((await request()).status).toBe(access === "edit" ? 200 : 403);
			expect(
				(await request(f.page.id, "text/plain", session.token, "prepare"))
					.status,
			).toBe(403);
			expect((await request(crypto.randomUUID())).status).toBe(403);
			if (access === "edit")
				expect((await request(f.page.id, "text/html")).status).toBe(415);
			const legacy = await f.login();
			expect(
				(await request(f.page.id, "text/plain", legacy.token)).status,
			).toBe(403);
			const key = `pages/${f.workspaceId}/${f.page.id}/notes.txt`;
			const read = app.server
				.rawRoute({
					name: "pageAttachment.read",
					method: "GET",
					path: "/api/files/*key",
				})
				.handle(
					async ({ ctx }) =>
						new Response(null, {
							status: (await canReadAttachment(ctx, key)) ? 200 : 404,
						}),
				);
			const get = (token = session.token) =>
				read(
					new Request(`http://beignet.test/api/files/${key}`, {
						headers: { authorization: `HaunterEmbed ${token}` },
					}),
				);
			expect((await get()).status).toBe(200);
			expect((await get(legacy.token)).status).toBe(200);
			for (const invalid of [
				`pages/other/${f.page.id}/notes.txt`,
				`pages/${f.workspaceId}/${crypto.randomUUID()}/notes.txt`,
				`pages/${f.workspaceId}/${f.page.id}/../notes.txt`,
			])
				expect(await canReadAttachment(f.ctx, invalid)).toBe(false);
			await f.ctx.ports.pages.setDeletedByIds(
				f.scope,
				[f.page.id],
				new Date().toISOString(),
			);
			expect((await get()).status).toBe(404);
			expect((await request()).status).toBe(403);
			await f.database.db.delete(schema.oauthConsent);
			expect((await get()).status).toBe(401);
			expect((await request()).status).toBe(401);
		} finally {
			await app.stop();
			await f.database.close();
		}
	},
);
