import type {
	AgentActivityWrite,
	AgentAdminRepository,
	AgentAdminRow,
	McpConnectionActivityWrite,
	McpConnectionRepository,
	McpConnectionRow,
} from "../ports";

export function createTestAgentAdminRepository(
	rows: AgentAdminRow[] = [],
	activities: AgentActivityWrite[] = [],
	currentApprovalIds?: Map<string, string | null>,
): AgentAdminRepository {
	return {
		async listByUser(userId: string) {
			return rows.filter((row) => row.userId === userId);
		},
		async findAwaitingApprovalById(agentId: string) {
			const row = rows.find(
				(candidate) =>
					candidate.id === agentId &&
					["pending", "active"].includes(candidate.status) &&
					candidate.grants.some((grant) => grant.status === "pending"),
			);
			return row ?? null;
		},
		async findCurrentApprovalIdByAgentId(agentId) {
			return currentApprovalIds?.has(agentId)
				? (currentApprovalIds.get(agentId) ?? null)
				: `approval_${agentId}`;
		},
		async recordActivity(activity) {
			activities.push(activity);
		},
		async listRecentActivityByUser(userId, limit) {
			return activities
				.filter((activity) => activity.userId === userId)
				.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
				.slice(0, limit)
				.map((activity) => ({
					...activity,
					agentName:
						rows.find((row) => row.id === activity.agentId)?.name ??
						"Unknown agent",
				}));
		},
	};
}

export function createTestMcpConnectionRepository(
	rows: McpConnectionRow[] = [],
	activities: McpConnectionActivityWrite[] = [],
): McpConnectionRepository {
	return {
		async authorize(input) {
			const existing = rows.find(
				(row) => row.userId === input.userId && row.clientId === input.clientId,
			);
			const row: McpConnectionRow = {
				id: existing?.id ?? input.id,
				userId: input.userId,
				clientId: input.clientId,
				clientName: existing?.clientName ?? "Test MCP client",
				permissionProfile: input.permissionProfile,
				status: "active",
				workspaceIds: [...input.workspaceIds],
				lastUsedAt: existing?.lastUsedAt ?? null,
				createdAt: existing?.createdAt ?? input.now,
				updatedAt: input.now,
			};
			if (existing) {
				rows.splice(rows.indexOf(existing), 1, row);
			} else {
				rows.push(row);
			}
			return row;
		},
		async findActive(userId, clientId) {
			return (
				rows.find(
					(row) =>
						row.userId === userId &&
						row.clientId === clientId &&
						row.status === "active",
				) ?? null
			);
		},
		async listByUser(userId) {
			return rows.filter(
				(row) => row.userId === userId && row.status === "active",
			);
		},
		async disconnectOwned(userId, connectionId, now) {
			const row = rows.find(
				(candidate) =>
					candidate.userId === userId &&
					candidate.id === connectionId &&
					candidate.status === "active",
			);
			if (!row) return false;
			row.status = "revoked";
			row.updatedAt = now;
			row.workspaceIds = [];
			return true;
		},
		async recordActivity(activity) {
			activities.push(activity);
		},
		async listRecentActivityByUser(userId, limit) {
			return activities
				.filter((activity) => activity.userId === userId)
				.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
				.slice(0, limit)
				.map((activity) => ({
					...activity,
					clientName:
						rows.find((row) => row.id === activity.connectionId)?.clientName ??
						null,
				}));
		},
	};
}
