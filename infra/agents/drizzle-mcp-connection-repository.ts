import "@beignet/core/server-only";
import type { DrizzleSqliteDatabase } from "@beignet/provider-db-drizzle/sqlite";
import { and, desc, eq, exists, inArray, isNull, lt, or } from "drizzle-orm";
import type {
	McpConnectionActivityWrite,
	McpConnectionRepository,
	McpConnectionRow,
} from "@/features/agents/ports";
import * as schema from "@/infra/db/schema";

type ConnectionRecord = Omit<McpConnectionRow, "workspaceIds">;

export function createDrizzleMcpConnectionRepository(
	db: DrizzleSqliteDatabase<typeof schema>,
): McpConnectionRepository {
	const connectionColumns = {
		id: schema.mcpConnection.id,
		userId: schema.mcpConnection.userId,
		clientId: schema.mcpConnection.clientId,
		clientName: schema.oauthClient.name,
		permissionProfile: schema.mcpConnection.permissionProfile,
		status: schema.mcpConnection.status,
		lastUsedAt: schema.mcpConnection.lastUsedAt,
		createdAt: schema.mcpConnection.createdAt,
		updatedAt: schema.mcpConnection.updatedAt,
	};

	async function workspaceIdsByConnection(connectionIds: string[]) {
		if (connectionIds.length === 0) return new Map<string, string[]>();
		const rows = await db
			.select({
				connectionId: schema.mcpConnectionWorkspace.connectionId,
				workspaceId: schema.mcpConnectionWorkspace.workspaceId,
			})
			.from(schema.mcpConnectionWorkspace)
			.where(
				inArray(schema.mcpConnectionWorkspace.connectionId, connectionIds),
			);
		const byConnection = new Map<string, string[]>();
		for (const row of rows) {
			const workspaceIds = byConnection.get(row.connectionId) ?? [];
			workspaceIds.push(row.workspaceId);
			byConnection.set(row.connectionId, workspaceIds);
		}
		return byConnection;
	}

	async function withWorkspaceIds(
		records: ConnectionRecord[],
	): Promise<McpConnectionRow[]> {
		const workspaces = await workspaceIdsByConnection(
			records.map((record) => record.id),
		);
		return records.map((record) => ({
			...record,
			workspaceIds: workspaces.get(record.id) ?? [],
		}));
	}

	function hasOAuthConsent(userId: string, clientId: string) {
		// The app profile is written immediately before the browser submits
		// Better Auth's consent form. Requiring both records keeps an interrupted
		// handoff from activating the connection (or reactivating an old JWT).
		return exists(
			db
				.select({ id: schema.oauthConsent.id })
				.from(schema.oauthConsent)
				.where(
					and(
						eq(schema.oauthConsent.userId, userId),
						eq(schema.oauthConsent.clientId, clientId),
					),
				),
		);
	}

	async function findActive(userId: string, clientId: string) {
		const records = await db
			.select(connectionColumns)
			.from(schema.mcpConnection)
			.innerJoin(
				schema.oauthClient,
				eq(schema.mcpConnection.clientId, schema.oauthClient.clientId),
			)
			.innerJoin(schema.user, eq(schema.mcpConnection.userId, schema.user.id))
			.where(
				and(
					eq(schema.mcpConnection.userId, userId),
					eq(schema.mcpConnection.clientId, clientId),
					eq(schema.mcpConnection.status, "active"),
					hasOAuthConsent(userId, clientId),
					or(
						eq(schema.oauthClient.disabled, false),
						isNull(schema.oauthClient.disabled),
					),
					or(eq(schema.user.banned, false), isNull(schema.user.banned)),
				),
			)
			.limit(1);
		return (await withWorkspaceIds(records))[0] ?? null;
	}

	return {
		async authorize(input) {
			const [client] = await db
				.select({
					clientId: schema.oauthClient.clientId,
					disabled: schema.oauthClient.disabled,
				})
				.from(schema.oauthClient)
				.where(eq(schema.oauthClient.clientId, input.clientId))
				.limit(1);
			if (!client || client.disabled) return null;

			const [connection] = await db
				.insert(schema.mcpConnection)
				.values({
					id: input.id,
					userId: input.userId,
					clientId: input.clientId,
					permissionProfile: input.permissionProfile,
					status: "active",
					createdAt: input.now,
					updatedAt: input.now,
				})
				.onConflictDoUpdate({
					target: [schema.mcpConnection.userId, schema.mcpConnection.clientId],
					set: {
						permissionProfile: input.permissionProfile,
						status: "active",
						updatedAt: input.now,
					},
				})
				.returning({ id: schema.mcpConnection.id });

			if (!connection) return null;
			await db
				.delete(schema.mcpConnectionWorkspace)
				.where(eq(schema.mcpConnectionWorkspace.connectionId, connection.id));
			if (input.workspaceIds.length > 0) {
				await db.insert(schema.mcpConnectionWorkspace).values(
					input.workspaceIds.map((workspaceId) => ({
						connectionId: connection.id,
						workspaceId,
						createdAt: input.now,
					})),
				);
			}

			const records = await db
				.select(connectionColumns)
				.from(schema.mcpConnection)
				.innerJoin(
					schema.oauthClient,
					eq(schema.mcpConnection.clientId, schema.oauthClient.clientId),
				)
				.where(eq(schema.mcpConnection.id, connection.id))
				.limit(1);
			return (await withWorkspaceIds(records))[0] ?? null;
		},

		findActive,

		async listByUser(userId) {
			const records = await db
				.select(connectionColumns)
				.from(schema.mcpConnection)
				.innerJoin(
					schema.oauthClient,
					eq(schema.mcpConnection.clientId, schema.oauthClient.clientId),
				)
				.where(
					and(
						eq(schema.mcpConnection.userId, userId),
						eq(schema.mcpConnection.status, "active"),
						exists(
							db
								.select({ id: schema.oauthConsent.id })
								.from(schema.oauthConsent)
								.where(
									and(
										eq(schema.oauthConsent.userId, schema.mcpConnection.userId),
										eq(
											schema.oauthConsent.clientId,
											schema.mcpConnection.clientId,
										),
									),
								),
						),
					),
				)
				.orderBy(desc(schema.mcpConnection.updatedAt));
			return withWorkspaceIds(records);
		},

		async disconnectOwned(userId, connectionId, now) {
			const [connection] = await db
				.select({ clientId: schema.mcpConnection.clientId })
				.from(schema.mcpConnection)
				.where(
					and(
						eq(schema.mcpConnection.id, connectionId),
						eq(schema.mcpConnection.userId, userId),
						eq(schema.mcpConnection.status, "active"),
					),
				)
				.limit(1);
			if (!connection) return false;

			await db
				.update(schema.mcpConnection)
				.set({ status: "revoked", updatedAt: now })
				.where(eq(schema.mcpConnection.id, connectionId));
			await db
				.delete(schema.mcpConnectionWorkspace)
				.where(eq(schema.mcpConnectionWorkspace.connectionId, connectionId));
			await db
				.delete(schema.oauthConsent)
				.where(
					and(
						eq(schema.oauthConsent.userId, userId),
						eq(schema.oauthConsent.clientId, connection.clientId),
					),
				);
			await db
				.delete(schema.oauthAccessToken)
				.where(
					and(
						eq(schema.oauthAccessToken.userId, userId),
						eq(schema.oauthAccessToken.clientId, connection.clientId),
					),
				);
			await db
				.delete(schema.oauthRefreshToken)
				.where(
					and(
						eq(schema.oauthRefreshToken.userId, userId),
						eq(schema.oauthRefreshToken.clientId, connection.clientId),
					),
				);
			return true;
		},

		async recordActivity(activity: McpConnectionActivityWrite) {
			await db.insert(schema.mcpConnectionActivity).values(activity);
			await db
				.update(schema.mcpConnection)
				.set({
					lastUsedAt: activity.createdAt,
					updatedAt: activity.createdAt,
				})
				.where(eq(schema.mcpConnection.id, activity.connectionId));
			await db
				.delete(schema.mcpConnectionActivity)
				.where(
					and(
						eq(schema.mcpConnectionActivity.userId, activity.userId),
						lt(
							schema.mcpConnectionActivity.createdAt,
							new Date(activity.createdAt.getTime() - 90 * 24 * 60 * 60 * 1000),
						),
					),
				);
		},

		async listRecentActivityByUser(userId, limit) {
			return db
				.select({
					id: schema.mcpConnectionActivity.id,
					connectionId: schema.mcpConnectionActivity.connectionId,
					clientName: schema.oauthClient.name,
					userId: schema.mcpConnectionActivity.userId,
					workspaceId: schema.mcpConnectionActivity.workspaceId,
					capability: schema.mcpConnectionActivity.capability,
					status: schema.mcpConnectionActivity.status,
					resourceType: schema.mcpConnectionActivity.resourceType,
					resourceId: schema.mcpConnectionActivity.resourceId,
					resourceLabel: schema.mcpConnectionActivity.resourceLabel,
					durationMs: schema.mcpConnectionActivity.durationMs,
					errorCode: schema.mcpConnectionActivity.errorCode,
					createdAt: schema.mcpConnectionActivity.createdAt,
				})
				.from(schema.mcpConnectionActivity)
				.innerJoin(
					schema.mcpConnection,
					eq(
						schema.mcpConnectionActivity.connectionId,
						schema.mcpConnection.id,
					),
				)
				.innerJoin(
					schema.oauthClient,
					eq(schema.mcpConnection.clientId, schema.oauthClient.clientId),
				)
				.where(eq(schema.mcpConnectionActivity.userId, userId))
				.orderBy(desc(schema.mcpConnectionActivity.createdAt))
				.limit(limit);
		},
	};
}
