import { z } from "zod";

export const AgentPermissionProfileSchema = z.enum(["view", "edit", "full"]);

export const AgentHostPermissionStateSchema = z.enum([
	"ask",
	"view",
	"edit",
	"full",
	"custom",
]);

export const AgentGrantSchema = z.object({
	capability: z.string(),
	status: z.string(),
	workspaceScope: z.string().nullable(),
});

export const AgentSummarySchema = z.object({
	id: z.string(),
	name: z.string(),
	mode: z.string(),
	status: z.string(),
	hostId: z.string(),
	hostName: z.string().nullable(),
	grants: z.array(AgentGrantSchema),
	lastUsedAt: z.string().datetime().nullable(),
	createdAt: z.string().datetime(),
});

export const AgentHostSummarySchema = z.object({
	id: z.string(),
	name: z.string().nullable(),
	permissionProfile: AgentHostPermissionStateSchema,
});

export const McpConnectionWorkspaceSchema = z.object({
	id: z.string(),
	name: z.string(),
});

export const McpConnectionSummarySchema = z.object({
	id: z.string().uuid(),
	clientId: z.string(),
	clientName: z.string().nullable(),
	permissionProfile: AgentPermissionProfileSchema,
	workspaces: z.array(McpConnectionWorkspaceSchema),
	lastUsedAt: z.string().datetime().nullable(),
	createdAt: z.string().datetime(),
});

export const ListAgentsOutputSchema = z.object({
	items: z.array(AgentSummarySchema),
	hosts: z.array(AgentHostSummarySchema),
	mcpConnections: z.array(McpConnectionSummarySchema),
	mcpResourceUrl: z.string().url(),
});

export const AuthorizeMcpConnectionInputSchema = z.object({
	oauthQuery: z.string().trim().min(1).max(16_384),
	permissionProfile: AgentPermissionProfileSchema,
	workspaceIds: z
		.array(z.string().min(1))
		.min(1)
		.max(50)
		.refine((ids) => new Set(ids).size === ids.length, {
			message: "Choose each workspace only once.",
		}),
});

export const GetMcpConsentContextInputSchema = z.object({
	oauthQuery: z.string().trim().min(1).max(16_384),
});

export const McpConsentContextSchema = z.object({
	clientId: z.string().min(1),
	clientName: z.string().nullable(),
	clientUri: z.string().url().nullable(),
	redirectUri: z.string().min(1).max(2_048),
	identityVerified: z.boolean(),
});

export const DisconnectMcpConnectionInputSchema = z.object({
	connectionId: z.string().uuid(),
});

export const DisconnectMcpConnectionOutputSchema = z.object({
	disconnected: z.literal(true),
});

export const ListAgentActivityInputSchema = z.object({
	limit: z.number().int().min(1).max(50).default(25),
});

export const AgentActivitySchema = z.object({
	id: z.string().uuid(),
	source: z.enum(["agent-auth", "remote-mcp"]),
	agentId: z.string().nullable(),
	connectionId: z.string().uuid().nullable(),
	agentName: z.string(),
	workspaceId: z.string().nullable(),
	capability: z.string(),
	status: z.enum(["success", "error"]),
	resourceType: z.enum(["page", "task"]).nullable(),
	resourceId: z.string().nullable(),
	resourceLabel: z.string().nullable(),
	durationMs: z.number().int().nonnegative(),
	error: z.string().nullable(),
	createdAt: z.string().datetime(),
});

export const ListAgentActivityOutputSchema = z.object({
	items: z.array(AgentActivitySchema),
});

export const PendingAgentInputSchema = z.object({
	agentId: z.string().min(1),
});

export const RequestedCapabilitySchema = z.object({
	name: z.string(),
	description: z.string(),
	workspaceScope: z.string().nullable(),
});

export const PendingAgentSchema = z.object({
	id: z.string(),
	approvalId: z.string(),
	name: z.string(),
	hostId: z.string(),
	hostName: z.string().nullable(),
	currentPermissionProfile: AgentHostPermissionStateSchema,
	minimumPermissionProfile: AgentPermissionProfileSchema.nullable(),
	requestedCapabilities: z.array(RequestedCapabilitySchema),
	createdAt: z.string().datetime(),
});

export type AgentGrant = z.infer<typeof AgentGrantSchema>;
export type AgentSummary = z.infer<typeof AgentSummarySchema>;
export type AgentHostSummary = z.infer<typeof AgentHostSummarySchema>;
export type McpConnectionSummary = z.infer<typeof McpConnectionSummarySchema>;
export type McpConsentContext = z.infer<typeof McpConsentContextSchema>;
export type AgentActivity = z.infer<typeof AgentActivitySchema>;
export type PendingAgent = z.infer<typeof PendingAgentSchema>;
