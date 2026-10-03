import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { oauthProvider } from "@better-auth/oauth-provider";
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
				redirectUris: ["http://127.0.0.1/callback"],
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
				scopes: ["openid", "haunter:mcp"],
				createdAt: now,
				updatedAt: now,
			});
			expect(
				await repository.findActive("user_mcp", "oauth_client"),
			).toMatchObject({ id: connection.id });
			expect(await repository.listByUser("user_mcp")).toHaveLength(1);

			for (const scopes of [
				[],
				["openid"],
				["haunter:mcp:extra", "prefix:haunter:mcp"],
				{ scope: "haunter:mcp" },
				["haunter:mcp", 1],
				"haunter:mcp",
				"not-json",
				JSON.stringify(JSON.stringify(["haunter:mcp"])),
			]) {
				await database.db
					.update(schema.oauthConsent)
					.set({ scopes })
					.where(eq(schema.oauthConsent.id, "consent_test"));
				expect(
					await repository.findActive("user_mcp", "oauth_client"),
				).toBeNull();
				expect(await repository.listByUser("user_mcp")).toEqual([]);
			}
			// Invalid storage must fail closed without a JSON SQL error.
			await database.client.execute({
				sql: 'UPDATE "oauth_consent" SET scopes = ? WHERE id = ?',
				args: ["invalid-json", "consent_test"],
			});
			expect(
				await repository.findActive("user_mcp", "oauth_client"),
			).toBeNull();
			expect(await repository.listByUser("user_mcp")).toEqual([]);

			// Exercise the real provider's SQLite array serialization, not just Drizzle fixtures.
			const adapter = drizzleAdapter(database.db, {
				provider: "sqlite",
				schema,
			})({
				plugins: [
					oauthProvider({
						loginPage: "/login",
						consentPage: "/consent",
						scopes: ["openid", "haunter:mcp"],
					}),
				],
			});
			for (const scopes of [["openid", "haunter:mcp"], ["openid"]]) {
				await adapter.update({
					model: "oauthConsent",
					where: [{ field: "id", value: "consent_test" }],
					update: { scopes },
				});
				expect(
					Boolean(await repository.findActive("user_mcp", "oauth_client")),
				).toBe(scopes.includes("haunter:mcp"));
				expect(await repository.listByUser("user_mcp")).toHaveLength(
					scopes.includes("haunter:mcp") ? 1 : 0,
				);
			}
			await database.db
				.update(schema.oauthConsent)
				.set({ scopes: ["haunter:mcp"] })
				.where(eq(schema.oauthConsent.id, "consent_test"));

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
				scopes: ["openid", "haunter:mcp"],
				expiresAt: new Date(now.getTime() + 60_000),
				createdAt: now,
			});
			await database.db.insert(schema.oauthAccessToken).values({
				id: "access_test",
				token: "access-token",
				clientId: "oauth_client",
				userId: "user_mcp",
				refreshId: "refresh_test",
				scopes: ["openid", "haunter:mcp"],
				expiresAt: new Date(now.getTime() + 60_000),
				createdAt: now,
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
