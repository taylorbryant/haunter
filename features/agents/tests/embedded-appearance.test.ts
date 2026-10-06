import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { defineRoutes } from "@beignet/core/server";
import { createTestApp } from "@beignet/web/testing";
import type { AppContext } from "@/app-context";
import * as schema from "@/infra/db/schema";
import { appContext, type AppServiceContextInput } from "@/server/context";
import { embeddedEditorAuthHooks } from "@/server/embedded-editor-auth";
import { embeddedEditorRoutes } from "../routes";
import { authorizeEmbeddedWorkspaceUseCase } from "../use-cases/authorize-embedded-workspace";
import { embeddedEditorFixture } from "./embedded-editor-fixture";

test.each(["view", "edit"] as const)(
	"%s sessions persist personal appearance across fresh sessions and reject unauthorized access",
	async (access) => {
		const f = await embeddedEditorFixture(access, access);
		const app = await createTestApp<
			AppContext,
			AppContext["ports"],
			AppServiceContextInput
		>({
			ports: f.ctx.ports,
			context: appContext,
			hooks: [embeddedEditorAuthHooks],
			routes: defineRoutes<AppContext>([embeddedEditorRoutes]),
		});
		async function login() {
			const proofSecret = crypto.randomUUID();
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
			if (!session) throw new Error("No embedded session");
			return session.token;
		}
		const request = (token?: string, body?: unknown) =>
			app.fetch("http://beignet.test/api/embedded-editor/appearance", {
				method: body ? "PUT" : "GET",
				headers: {
					...(token ? { authorization: `HaunterEmbed ${token}` } : {}),
					"content-type": "application/json",
				},
				...(body ? { body: JSON.stringify(body) } : {}),
			});
		try {
			const token = await login();
			expect(await (await request(token)).json()).toEqual({ theme: "host" });
			const save = await request(token, { theme: "dracula" });
			expect(save.status).toBe(200);
			expect(save.headers.get("cache-control")).toBe("no-store");
			expect(await save.json()).toEqual({ theme: "dracula" });
			const reopened = await login();
			expect(reopened).not.toBe(token);
			expect(await (await request(reopened)).json()).toEqual({
				theme: "dracula",
			});
			const now = new Date();
			await f.database.db.insert(schema.user).values({
				id: "another-user",
				name: "Other",
				email: "other@example.test",
				createdAt: now,
				updatedAt: now,
			});
			expect(await f.ctx.ports.embeddedAppearance.get("another-user")).toEqual({
				theme: "host",
			});
			expect(
				(await request(reopened, { theme: "nord", userId: "another-user" }))
					.status,
			).toBe(422);
			expect((await request(reopened, { theme: "not-a-theme" })).status).toBe(
				422,
			);
			const documentSession = await f.login();
			for (const body of [undefined, { theme: "light" }]) {
				expect((await request(undefined, body)).status).toBe(403);
				expect((await request(documentSession.token, body)).status).toBe(403);
			}
			expect((await request(reopened, { theme: "host" })).status).toBe(200);
			expect(await (await request(await login())).json()).toEqual({
				theme: "host",
			});
			await f.ctx.ports.mcpConnections.disconnectOwned(
				f.userId,
				f.connection.id,
				new Date(),
			);
			expect((await request(reopened, { theme: "dracula" })).status).toBe(401);
			expect(await f.ctx.ports.embeddedAppearance.get(f.userId)).toEqual({
				theme: "host",
			});
		} finally {
			await app.stop();
			await f.database.close();
		}
	},
);
