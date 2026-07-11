import type {
	AgentActivityWrite,
	AgentAdminRepository,
	AgentAdminRow,
} from "../ports";

export function createTestAgentAdminRepository(
	rows: AgentAdminRow[] = [],
	activities: AgentActivityWrite[] = [],
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
