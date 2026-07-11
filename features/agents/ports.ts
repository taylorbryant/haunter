/** An agent row with its host name and grants, shaped for admin reads. */
export type AgentAdminRow = {
	id: string;
	name: string;
	mode: string;
	status: string;
	userId: string | null;
	hostName: string | null;
	grants: { capability: string; status: string }[];
	lastUsedAt: Date | null;
	createdAt: Date;
};

export type AgentActivityStatus = "success" | "error";
export type AgentActivityResourceType = "page" | "task";

export type AgentActivityWrite = {
	id: string;
	agentId: string;
	userId: string;
	workspaceId: string | null;
	capability: string;
	status: AgentActivityStatus;
	resourceType: AgentActivityResourceType | null;
	resourceId: string | null;
	resourceLabel: string | null;
	durationMs: number;
	error: string | null;
	createdAt: Date;
};

export type AgentActivityRow = AgentActivityWrite & {
	agentName: string;
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
	 * An initial registration or active agent with pending capability requests.
	 * Returns null when there is no approval decision left to make.
	 */
	findAwaitingApprovalById(agentId: string): Promise<AgentAdminRow | null>;
	/** Best-effort audit write for a completed capability execution. */
	recordActivity(activity: AgentActivityWrite): Promise<void>;
	/** Most recent capability executions belonging to one user. */
	listRecentActivityByUser(
		userId: string,
		limit: number,
	): Promise<AgentActivityRow[]>;
}
