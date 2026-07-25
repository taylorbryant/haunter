import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import * as schema from "@/infra/db/schema";
import { createTestDatabase } from "@/infra/db/test-database";
import {
	OAUTH_DCR_ALLOCATION_MARKER_PREFIX,
	OAUTH_DCR_ALLOCATION_METADATA_KEY,
	OAUTH_DCR_MAX_UNUSED_CLIENTS,
	OAUTH_DCR_MAX_UNUSED_CLIENTS_PER_SOURCE,
} from "@/lib/oauth-dcr-request";
import { ACCESS_STATUS_APPROVED } from "@/ports/auth";

function dynamicClient(
	index: number | string,
	createdAt = new Date("2026-07-23T12:00:00.000Z"),
	allocationKey = "source-a",
) {
	const redirectUri = `http://127.0.0.1:1455/callback/${index}`;
	return {
		id: `oauth_row_${index}`,
		clientId: `oauth_client_${index}`,
		name: `Client ${index}`,
		redirectUris: JSON.stringify([redirectUri]),
		tokenEndpointAuthMethod: "none",
		public: true,
		metadata: JSON.stringify({
			[OAUTH_DCR_ALLOCATION_METADATA_KEY]: `${OAUTH_DCR_ALLOCATION_MARKER_PREFIX}${allocationKey}`,
		}),
		createdAt,
		updatedAt: createdAt,
	};
}

describe("hosted MCP OAuth client repository", () => {
	test("binds consent to the registered redirect and retires only stale unused DCR clients", async () => {
		const database = await createTestDatabase();
		try {
			const oldUnused = dynamicClient("old-unused");
			const oldConsented = dynamicClient("old-consented");
			const recentUnused = dynamicClient(
				"recent-unused",
				new Date("2026-07-25T11:30:00.000Z"),
			);
			await database.db
				.insert(schema.oauthClient)
				.values([oldUnused, oldConsented, recentUnused]);
			await database.db.insert(schema.oauthConsent).values({
				id: "consent_old",
				clientId: oldConsented.clientId,
				scopes: JSON.stringify(["openid", "haunter:mcp"]),
				createdAt: new Date("2026-07-23T12:05:00.000Z"),
			});

			const repository = database.repositories.mcpOAuthClients;
			const oldUnusedRedirectUri = `http://127.0.0.1:1455/callback/old-unused`;
			await expect(
				repository.findForConsent({
					clientId: oldUnused.clientId,
					redirectUri: oldUnusedRedirectUri,
				}),
			).resolves.toEqual({
				clientId: oldUnused.clientId,
				clientName: oldUnused.name,
				clientUri: null,
				redirectUri: oldUnusedRedirectUri,
				identityVerified: false,
			});
			await database.db
				.update(schema.oauthClient)
				.set({
					redirectUris: JSON.stringify(["http://127.0.0.1/callback"]),
				})
				.where(eq(schema.oauthClient.clientId, oldUnused.clientId));
			await expect(
				repository.findForConsent({
					clientId: oldUnused.clientId,
					redirectUri: "http://127.0.0.1:49152/callback",
				}),
			).resolves.toMatchObject({
				redirectUri: "http://127.0.0.1:49152/callback",
			});
			await expect(
				repository.findForConsent({
					clientId: oldUnused.clientId,
					redirectUri: "https://evil.example/callback",
				}),
			).resolves.toBeNull();

			await expect(repository.countUnusedDynamic()).resolves.toBe(2);
			await expect(repository.countUnusedDynamic("source-a")).resolves.toBe(2);
			await expect(
				repository.retireUnusedDynamicBefore(
					new Date("2026-07-24T12:00:00.000Z"),
					100,
				),
			).resolves.toBe(1);
			await expect(repository.countUnusedDynamic()).resolves.toBe(1);

			const remaining = await database.db
				.select({ clientId: schema.oauthClient.clientId })
				.from(schema.oauthClient);
			expect(remaining.map((row) => row.clientId).sort()).toEqual(
				[oldConsented.clientId, recentUnused.clientId].sort(),
			);
		} finally {
			await database.close();
		}
	});

	test("bounds session-owned rows and retires revoked but not active clients", async () => {
		const database = await createTestDatabase();
		try {
			const now = new Date("2026-07-23T12:00:00.000Z");
			await database.db.insert(schema.user).values({
				id: "user_dcr",
				name: "DCR User",
				email: "dcr@example.com",
				emailVerified: true,
				accessStatus: ACCESS_STATUS_APPROVED,
				createdAt: now,
				updatedAt: now,
			});
			const sessionOwned = {
				...dynamicClient("session-owned", now),
				userId: "user_dcr",
			};
			const active = dynamicClient("active", now);
			const revoked = dynamicClient("revoked", now);
			await database.db
				.insert(schema.oauthClient)
				.values([sessionOwned, active, revoked]);
			await database.db.insert(schema.mcpConnection).values([
				{
					id: "connection_active",
					userId: "user_dcr",
					clientId: active.clientId,
					permissionProfile: "view",
					status: "active",
					createdAt: now,
					updatedAt: now,
				},
				{
					id: "connection_revoked",
					userId: "user_dcr",
					clientId: revoked.clientId,
					permissionProfile: "view",
					status: "revoked",
					createdAt: now,
					updatedAt: now,
				},
			]);

			const repository = database.repositories.mcpOAuthClients;
			await expect(repository.countUnusedDynamic()).resolves.toBe(2);
			await expect(
				repository.retireUnusedDynamicBefore(
					new Date("2026-07-24T12:00:00.000Z"),
					100,
				),
			).resolves.toBe(2);

			const remaining = await database.db
				.select({ clientId: schema.oauthClient.clientId })
				.from(schema.oauthClient);
			expect(remaining).toEqual([{ clientId: active.clientId }]);
			const remainingConnections = await database.db
				.select({ id: schema.mcpConnection.id })
				.from(schema.mcpConnection);
			expect(remainingConnections).toEqual([{ id: "connection_active" }]);
		} finally {
			await database.close();
		}
	});

	test("enforces race-safe per-source and global registration ceilings", async () => {
		const sourceDatabase = await createTestDatabase();
		try {
			await sourceDatabase.db
				.insert(schema.oauthClient)
				.values(
					Array.from(
						{ length: OAUTH_DCR_MAX_UNUSED_CLIENTS_PER_SOURCE },
						(_, index) => dynamicClient(index, undefined, "source-a"),
					),
				);

			let sourceOverflowError: unknown;
			try {
				await sourceDatabase.db
					.insert(schema.oauthClient)
					.values(dynamicClient("same-source-overflow", undefined, "source-a"));
			} catch (error) {
				sourceOverflowError = error;
			}
			expect(sourceOverflowError).toBeDefined();
			expect(
				String((sourceOverflowError as { cause?: unknown }).cause),
			).toContain("unused dynamic OAuth client quota exceeded");
			await expect(
				(async () => {
					await sourceDatabase.db
						.insert(schema.oauthClient)
						.values(dynamicClient("other-source", undefined, "source-b"));
				})(),
			).resolves.toBeUndefined();
		} finally {
			await sourceDatabase.close();
		}

		const database = await createTestDatabase();
		try {
			await database.db
				.insert(schema.oauthClient)
				.values(
					Array.from({ length: OAUTH_DCR_MAX_UNUSED_CLIENTS }, (_, index) =>
						dynamicClient(
							index,
							undefined,
							`source-${Math.floor(
								index / OAUTH_DCR_MAX_UNUSED_CLIENTS_PER_SOURCE,
							)}`,
						),
					),
				);
			let overflowError: unknown;
			try {
				await database.db
					.insert(schema.oauthClient)
					.values(dynamicClient("overflow"));
			} catch (error) {
				overflowError = error;
			}
			expect(overflowError).toBeDefined();
			expect(String((overflowError as { cause?: unknown }).cause)).toContain(
				"unused dynamic OAuth client quota exceeded",
			);

			await database.db.insert(schema.oauthConsent).values({
				id: "consent_capacity",
				clientId: "oauth_client_0",
				scopes: JSON.stringify(["openid", "haunter:mcp"]),
			});
			await expect(
				(async () => {
					await database.db
						.insert(schema.oauthClient)
						.values(dynamicClient("replacement"));
				})(),
			).resolves.toBeUndefined();
			expect(
				await database.db
					.select({ clientId: schema.oauthClient.clientId })
					.from(schema.oauthClient)
					.where(eq(schema.oauthClient.clientId, "oauth_client_replacement")),
			).toHaveLength(1);
		} finally {
			await database.close();
		}
	});
});
