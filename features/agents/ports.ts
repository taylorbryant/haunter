export type AgentCapabilityGrant = {
	capability: string;
	status: string;
	constraints: Record<string, unknown> | null;
};

/** An agent row with its host name and grants, shaped for admin reads. */
export type AgentAdminRow = {
	id: string;
	name: string;
	mode: string;
	status: string;
	userId: string | null;
	hostId: string;
	hostName: string | null;
	hostStatus: string | null;
	hostDefaultCapabilities: string[];
	grants: AgentCapabilityGrant[];
	lastUsedAt: Date | null;
	createdAt: Date;
};

export type AgentActivityStatus = "success" | "error";
export type AgentActivityResourceType = "page" | "task";

export type AgentPresenceStatus =
	| "reading"
	| "editing"
	| "creating"
	| "organizing"
	| "finished";

export type AgentPagePresence = {
	pageId: string;
	presenceId: string;
	name: string;
	status: AgentPresenceStatus;
	capability: string;
	ttlSeconds: number;
};

/** Ephemeral collaboration presence for an agent working in a page room. */
export interface AgentPresencePort {
	setPagePresence(presence: AgentPagePresence): Promise<void>;
}

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

export type McpConnectionStatus = "active" | "revoked";

export type McpConnectionRow = {
	id: string;
	userId: string;
	clientId: string;
	clientName: string | null;
	permissionProfile: "view" | "edit" | "full";
	status: McpConnectionStatus;
	workspaceIds: string[];
	lastUsedAt: Date | null;
	createdAt: Date;
	updatedAt: Date;
};

export type McpConnectionActivityWrite = {
	id: string;
	connectionId: string;
	userId: string;
	workspaceId: string | null;
	capability: string;
	status: AgentActivityStatus;
	resourceType: AgentActivityResourceType | null;
	resourceId: string | null;
	resourceLabel: string | null;
	durationMs: number;
	errorCode: string | null;
	createdAt: Date;
};

export type McpConnectionActivityRow = McpConnectionActivityWrite & {
	clientName: string | null;
};

export type McpOAuthClientConsentContext = {
	clientId: string;
	clientName: string | null;
	clientUri: string | null;
	redirectUri: string;
	identityVerified: boolean;
};

export interface McpOAuthClientRepository {
	/**
	 * Resolve the exact redirect from a signed authorization request against
	 * the client's registered redirects. Client-provided identity metadata is
	 * deliberately marked unverified unless Haunter adds a trusted registry.
	 */
	findForConsent(input: {
		clientId: string;
		redirectUri: string;
	}): Promise<McpOAuthClientConsentContext | null>;
	/**
	 * Number of server-marked DCR clients that never reached user consent.
	 * Passing an allocation key narrows the count to one registration source.
	 */
	countUnusedDynamic(allocationKey?: string): Promise<number>;
	/**
	 * Retire stale DCR registrations that have no consent, tokens, or active
	 * app-level connection. Revoked connections are intentionally eligible.
	 * Returns the number removed.
	 */
	retireUnusedDynamicBefore(cutoff: Date, limit: number): Promise<number>;
}

export interface McpConnectionRepository {
	/**
	 * Authorize a user/client pair. Returns null when the OAuth client does not
	 * exist or has been disabled.
	 */
	authorize(input: {
		id: string;
		userId: string;
		clientId: string;
		permissionProfile: McpConnectionRow["permissionProfile"];
		workspaceIds: string[];
		now: Date;
	}): Promise<McpConnectionRow | null>;
	findActive(
		userId: string,
		clientId: string,
	): Promise<McpConnectionRow | null>;
	listByUser(userId: string): Promise<McpConnectionRow[]>;
	/**
	 * Revoke app authorization and the OAuth consent/refresh material for the
	 * owning user. Current JWTs are stopped by the app connection check.
	 */
	disconnectOwned(
		userId: string,
		connectionId: string,
		now: Date,
	): Promise<boolean>;
	recordActivity(activity: McpConnectionActivityWrite): Promise<void>;
	listRecentActivityByUser(
		userId: string,
		limit: number,
	): Promise<McpConnectionActivityRow[]>;
}

export interface McpOAuthRequestVerifier {
	/**
	 * Verify Better Auth's signed authorization query and return the client and
	 * exact redirect it names. The signature expiry is enforced by the
	 * implementation.
	 */
	verify(
		oauthQuery: string,
	): Promise<{ clientId: string; redirectUri: string } | null>;
}

export interface McpServerConfigurationPort {
	resourceUrl: string;
}

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
	/** Latest unexpired device approval for an agent, if one exists. */
	findCurrentApprovalIdByAgentId(
		agentId: string,
		now: Date,
	): Promise<string | null>;
	/** Best-effort audit write for a completed capability execution. */
	recordActivity(activity: AgentActivityWrite): Promise<void>;
	/** Most recent capability executions belonging to one user. */
	listRecentActivityByUser(
		userId: string,
		limit: number,
	): Promise<AgentActivityRow[]>;
}
