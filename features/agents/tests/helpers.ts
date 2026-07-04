import type { AgentAdminRepository, AgentAdminRow } from "../ports";

export function createTestAgentAdminRepository(
	rows: (AgentAdminRow & { userId: string | null })[] = [],
): AgentAdminRepository {
	return {
		async listByUser(userId: string) {
			return rows
				.filter((row) => row.userId === userId)
				.map(({ userId: _userId, ...row }) => row);
		},
		async findPendingById(agentId: string) {
			const row = rows.find(
				(candidate) =>
					candidate.id === agentId && candidate.status === "pending",
			);
			if (!row) return null;
			const { userId: _userId, ...rest } = row;
			return rest;
		},
	};
}
