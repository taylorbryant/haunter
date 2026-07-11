import type { AgentAdminRepository, AgentAdminRow } from "../ports";

export function createTestAgentAdminRepository(
	rows: AgentAdminRow[] = [],
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
	};
}
