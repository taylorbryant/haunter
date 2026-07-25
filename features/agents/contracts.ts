import { defineContractGroup } from "@beignet/core/contracts";
import { z } from "zod";
import {
	AuthorizeMcpConnectionInputSchema,
	DisconnectMcpConnectionInputSchema,
	DisconnectMcpConnectionOutputSchema,
	GetMcpConsentContextInputSchema,
	ListAgentActivityInputSchema,
	ListAgentActivityOutputSchema,
	ListAgentsOutputSchema,
	McpConnectionSummarySchema,
	McpConsentContextSchema,
	PendingAgentInputSchema,
	PendingAgentSchema,
} from "@/features/agents/schemas";
import { errors } from "@/features/shared/errors";

const ErrorResponseSchema = z.object({
	code: z.string(),
	message: z.string(),
	requestId: z.string().optional(),
});

const agents = defineContractGroup()
	.namespace("agents")
	.meta({ auth: "required" })
	.responses({
		500: ErrorResponseSchema,
	});

export const listAgents = agents
	.get("/api/agents")
	.meta({ rateLimit: { max: 120, windowSec: 60, scope: "user" } })
	.errors({
		Unauthorized: errors.Unauthorized,
	})
	.responses({
		200: ListAgentsOutputSchema,
	});

export const listAgentActivity = agents
	.get("/api/agents/activity")
	.query(ListAgentActivityInputSchema)
	.meta({ rateLimit: { max: 120, windowSec: 60, scope: "user" } })
	.errors({
		Unauthorized: errors.Unauthorized,
	})
	.responses({
		200: ListAgentActivityOutputSchema,
	});

export const authorizeMcpConnection = agents
	.post("/api/agents/mcp-connections")
	.body(AuthorizeMcpConnectionInputSchema)
	.meta({ rateLimit: { max: 30, windowSec: 60, scope: "user" } })
	.errors({
		Unauthorized: errors.Unauthorized,
		Forbidden: errors.Forbidden,
		McpClientNotFound: errors.McpClientNotFound,
	})
	.responses({
		200: McpConnectionSummarySchema,
	});

export const getMcpConsentContext = agents
	.post("/api/agents/mcp-consent-context")
	.body(GetMcpConsentContextInputSchema)
	.meta({ rateLimit: { max: 60, windowSec: 60, scope: "user" } })
	.errors({
		Unauthorized: errors.Unauthorized,
		McpClientNotFound: errors.McpClientNotFound,
	})
	.responses({
		200: McpConsentContextSchema,
	});

export const disconnectMcpConnection = agents
	.delete("/api/agents/mcp-connections/:connectionId")
	.pathParams(DisconnectMcpConnectionInputSchema)
	.meta({ rateLimit: { max: 30, windowSec: 60, scope: "user" } })
	.errors({
		Unauthorized: errors.Unauthorized,
		McpConnectionNotFound: errors.McpConnectionNotFound,
	})
	.responses({
		200: DisconnectMcpConnectionOutputSchema,
	});

// The device-approval page's read: the agent id comes from the verification
// link the agent hands its user. Initial registrations and active agents with
// pending capability grants resolve; approval itself still requires the user
// code, checked by the agent-auth plugin.
export const getPendingAgent = agents
	.get("/api/agents/pending/:agentId")
	.pathParams(PendingAgentInputSchema)
	.meta({ rateLimit: { max: 60, windowSec: 60, scope: "user" } })
	.errors({
		Unauthorized: errors.Unauthorized,
		AgentNotFound: errors.AgentNotFound,
	})
	.responses({
		200: PendingAgentSchema,
	});
