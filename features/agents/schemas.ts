import { z } from "zod";

export const AgentGrantSchema = z.object({
	capability: z.string(),
	status: z.string(),
});

export const AgentSummarySchema = z.object({
	id: z.string(),
	name: z.string(),
	mode: z.string(),
	status: z.string(),
	hostName: z.string().nullable(),
	grants: z.array(AgentGrantSchema),
	lastUsedAt: z.string().datetime().nullable(),
	createdAt: z.string().datetime(),
});

export const ListAgentsOutputSchema = z.object({
	items: z.array(AgentSummarySchema),
});

export const ListAgentActivityInputSchema = z.object({
	limit: z.coerce.number().int().min(1).max(50).default(25),
});

export const AgentActivitySchema = z.object({
	id: z.string().uuid(),
	agentId: z.string(),
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
});

export const PendingAgentSchema = z.object({
	id: z.string(),
	approvalId: z.string(),
	name: z.string(),
	hostName: z.string().nullable(),
	requestedCapabilities: z.array(RequestedCapabilitySchema),
	createdAt: z.string().datetime(),
});

export type AgentGrant = z.infer<typeof AgentGrantSchema>;
export type AgentSummary = z.infer<typeof AgentSummarySchema>;
export type AgentActivity = z.infer<typeof AgentActivitySchema>;
export type PendingAgent = z.infer<typeof PendingAgentSchema>;
