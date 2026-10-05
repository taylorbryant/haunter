import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { createTenantScope } from "@beignet/core/ports";
import { defineRoutes } from "@beignet/core/server";
import { createTestApp } from "@beignet/web/testing";
import { eq } from "drizzle-orm";
import type { AppContext } from "@/app-context";
import { memberRoutes } from "@/features/members/routes";
import { taskRoutes } from "@/features/tasks/routes";
import { createTaskUseCase } from "@/features/tasks/use-cases";
import * as schema from "@/infra/db/schema";
import { appContext, type AppServiceContextInput } from "@/server/context";
import { embeddedEditorAuthHooks } from "@/server/embedded-editor-auth";
import { authorizeEmbeddedWorkspaceUseCase } from "../use-cases/authorize-embedded-workspace";
import { embeddedEditorFixture } from "./embedded-editor-fixture";

test.each([
	["edit", "edit"],
	["view", "edit"],
	["edit", "view"],
] as const)(
	"task HTTP and assignees respect embedded consent %s and profile %s",
	async (access, profile) => {
		const f = await embeddedEditorFixture(access, profile);
		const app = await createTestApp<
			AppContext,
			AppContext["ports"],
			AppServiceContextInput
		>({
			ports: f.ctx.ports,
			context: appContext,
			hooks: [embeddedEditorAuthHooks],
			routes: defineRoutes<AppContext>([taskRoutes, memberRoutes]),
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
					...(body === undefined ? {} : { body: JSON.stringify(body) }),
				});
			const writable = access === "edit" && profile === "edit";
			const task = await createTaskUseCase.run({
				ctx: f.ctx,
				input: { workspaceId: f.workspaceId, title: "Existing task" },
			});
			expect(
				(await request(`/api/workspaces/${f.workspaceId}/tasks?scope=mine`))
					.status,
			).toBe(200);
			const roster = await request(`/api/workspaces/${f.workspaceId}/members`);
			expect(roster.status).toBe(200);
			expect((await roster.json()).items).toEqual([
				expect.objectContaining({ userId: f.userId, name: "Document User" }),
			]);
			expect((await request("/api/workspaces/other/members")).status).toBe(403);
			expect((await request("/api/workspaces/other/tasks")).status).toBe(403);
			expect(
				(
					await request("/api/tasks", "POST", {
						workspaceId: "other",
						title: "No",
					})
				).status,
			).toBe(403);
			const created = await request("/api/tasks", "POST", {
				workspaceId: f.workspaceId,
				title: "From panel",
				dueDate: "2026-10-08",
				assigneeId: f.userId,
			});
			expect(created.status).toBe(writable ? 201 : 403);
			for (const patch of [
				{ title: "Renamed" },
				{ completed: true },
				{ dueDate: "2026-10-09", dueTime: "14:00" },
				{ assigneeId: null },
			])
				expect(
					(await request(`/api/tasks/${task.id}`, "PATCH", patch)).status,
				).toBe(writable ? 200 : 403);
			expect(
				(
					await request(`/api/tasks/${task.id}`, "PATCH", {
						assigneeId: "outsider",
					})
				).status,
			).toBe(403);
			if (writable)
				expect(
					(
						await (
							await request(
								`/api/workspaces/${f.workspaceId}/tasks?filter=completed`,
							)
						).json()
					).items,
				).toEqual([
					expect.objectContaining({
						id: task.id,
						completed: true,
						title: "Renamed",
						dueDate: "2026-10-09",
						dueTime: "14:00",
						assigneeId: null,
					}),
				]);
			// Membership elsewhere still cannot expand this workspace credential.
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
					id: "foreign-member",
					organizationId: "other",
					userId: f.userId,
					role: "owner",
					createdAt: new Date(),
				});
			const foreign = await f.ctx.ports.tasks.create(
				createTenantScope({ id: "other" }),
				{
					userId: f.userId,
					title: "Private task",
					pageId: null,
					sourceBlockId: null,
					completed: false,
					dueDate: null,
					dueTime: null,
					reminderOffsetMinutes: null,
					assigneeId: f.userId,
					completedAt: null,
				},
			);
			for (const method of ["PATCH", "DELETE"])
				expect(
					(
						await request(
							`/api/tasks/${foreign.id}`,
							method,
							method === "PATCH" ? { completed: true } : undefined,
						)
					).status,
				).toBe(writable ? 404 : 403);
			expect((await request(`/api/tasks/${task.id}`, "DELETE")).status).toBe(
				writable ? 204 : 403,
			);
			const legacy = await f.login();
			for (const path of [
				`/api/workspaces/${f.workspaceId}/tasks`,
				`/api/workspaces/${f.workspaceId}/members`,
			])
				expect(
					(await request(path, "GET", undefined, legacy.token)).status,
				).toBe(403);
			await f.database.db
				.update(schema.member)
				.set({ role: "viewer" })
				.where(eq(schema.member.id, "document-member"));
			expect(
				(
					await request("/api/tasks", "POST", {
						workspaceId: f.workspaceId,
						title: "After downgrade",
					})
				).status,
			).toBe(403);
			await f.database.db.delete(schema.oauthConsent);
			expect(
				(await request(`/api/workspaces/${f.workspaceId}/tasks`)).status,
			).toBe(401);
		} finally {
			await app.stop();
			await f.database.close();
		}
	},
);
