import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import * as schema from "@/infra/db/schema";
import { createTestDatabase } from "@/infra/db/test-database";
import { ACCESS_STATUS_APPROVED } from "@/ports/auth";

describe("hosted MCP connection repository", () => {
	test("authorizes, audits, rejects banned users, and disconnects OAuth access", async () => {
		const database = await createTestDatabase();
		try {
			const now = new Date("2026-07-25T12:00:00.000Z");
			await database.db.insert(schema.user).values({
				id: "user_mcp",
				name: "MCP User",
				email: "mcp@example.com",
				emailVerified: true,
				accessStatus: ACCESS_STATUS_APPROVED,
				createdAt: now,
				updatedAt: now,
			});
			await database.db.insert(schema.organization).values({
				id: "workspace_mcp",
				name: "MCP Workspace",
				slug: "mcp-workspace",
				createdAt: now,
			});
			await database.db.insert(schema.oauthClient).values({
				id: "oauth_row",
				clientId: "oauth_client",
				name: "Codex",
				redirectUris: JSON.stringify(["http://127.0.0.1/callback"]),
			});

			const repository = database.repositories.mcpConnections;
			const connection = await repository.authorize({
				id: crypto.randomUUID(),
				userId: "user_mcp",
				clientId: "oauth_client",
				permissionProfile: "edit",
				workspaceIds: ["workspace_mcp"],
				now,
			});
			expect(connection).toMatchObject({
				clientName: "Codex",
				permissionProfile: "edit",
				workspaceIds: ["workspace_mcp"],
				status: "active",
			});
			if (!connection) throw new Error("Expected an MCP connection.");
			expect(
				await repository.findActive("user_mcp", "oauth_client"),
			).toBeNull();
			expect(await repository.listByUser("user_mcp")).toEqual([]);

			await database.db.insert(schema.oauthConsent).values({
				id: "consent_test",
				clientId: "oauth_client",
				userId: "user_mcp",
				scopes: JSON.stringify(["openid", "haunter:mcp"]),
			});
			expect(
				await repository.findActive("user_mcp", "oauth_client"),
			).toMatchObject({ id: connection.id });
			expect(await repository.listByUser("user_mcp")).toHaveLength(1);

			await repository.recordActivity({
				id: crypto.randomUUID(),
				connectionId: connection.id,
				userId: "user_mcp",
				workspaceId: "workspace_mcp",
				capability: "read_page",
				status: "success",
				resourceType: "page",
				resourceId: "page_test",
				resourceLabel: "Test page",
				durationMs: 7,
				errorCode: null,
				createdAt: now,
			});
			expect(await repository.listRecentActivityByUser("user_mcp", 10)).toEqual(
				[
					expect.objectContaining({
						clientName: "Codex",
						capability: "read_page",
					}),
				],
			);

			await database.db
				.update(schema.user)
				.set({ banned: true })
				.where(eq(schema.user.id, "user_mcp"));
			expect(
				await repository.findActive("user_mcp", "oauth_client"),
			).toBeNull();
			await database.db
				.update(schema.user)
				.set({ banned: false })
				.where(eq(schema.user.id, "user_mcp"));

			await database.db.insert(schema.oauthRefreshToken).values({
				id: "refresh_test",
				token: "refresh-token",
				clientId: "oauth_client",
				userId: "user_mcp",
				scopes: JSON.stringify(["openid", "haunter:mcp"]),
			});
			await database.db.insert(schema.oauthAccessToken).values({
				id: "access_test",
				token: "access-token",
				clientId: "oauth_client",
				userId: "user_mcp",
				refreshId: "refresh_test",
				scopes: JSON.stringify(["openid", "haunter:mcp"]),
			});

			await expect(
				repository.disconnectOwned("user_mcp", connection.id, new Date()),
			).resolves.toBeTrue();
			expect(
				await repository.findActive("user_mcp", "oauth_client"),
			).toBeNull();
			expect(await database.db.select().from(schema.oauthConsent)).toEqual([]);
			expect(await database.db.select().from(schema.oauthAccessToken)).toEqual(
				[],
			);
			expect(await database.db.select().from(schema.oauthRefreshToken)).toEqual(
				[],
			);
		} finally {
			await database.close();
		}
	});
});
