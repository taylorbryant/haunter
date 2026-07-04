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

export const PendingAgentInputSchema = z.object({
	agentId: z.string().min(1),
});

export const RequestedCapabilitySchema = z.object({
	name: z.string(),
	description: z.string(),
});

export const PendingAgentSchema = z.object({
	id: z.string(),
	name: z.string(),
	hostName: z.string().nullable(),
	requestedCapabilities: z.array(RequestedCapabilitySchema),
	createdAt: z.string().datetime(),
});

export type AgentGrant = z.infer<typeof AgentGrantSchema>;
export type AgentSummary = z.infer<typeof AgentSummarySchema>;
export type PendingAgent = z.infer<typeof PendingAgentSchema>;
