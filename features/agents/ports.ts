/** An agent row with its host name and grants, shaped for admin reads. */
export type AgentAdminRow = {
	id: string;
	name: string;
	mode: string;
	status: string;
	hostName: string | null;
	grants: { capability: string; status: string }[];
	lastUsedAt: Date | null;
	createdAt: Date;
};

/**
 * Read-side repository for agent administration. All writes (approve, deny,
 * revoke) go through the agent-auth plugin's own /api/auth endpoints so its
 * grant lifecycle, audit events, and ownership checks stay authoritative.
 */
export interface AgentAdminRepository {
	/** The user's agents (delegated agents carry userId once approved). */
	listByUser(userId: string): Promise<AgentAdminRow[]>;
	/**
	 * A pending agent by id, with its pending capability requests — the
	 * device-approval page's read. Returns null unless status is "pending".
	 */
	findPendingById(agentId: string): Promise<AgentAdminRow | null>;
}
