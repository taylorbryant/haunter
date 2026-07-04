import { defineContractGroup } from "@beignet/core/contracts";
import { z } from "zod";
import {
	ListAgentsOutputSchema,
	PendingAgentInputSchema,
	PendingAgentSchema,
} from "@/features/agents/schemas";
import { errors } from "@/features/shared/errors";

const ErrorResponseSchema = z.object({
	code: z.string(),
	message: z.string(),
	requestId: z.string().optional(),
});

const agents = defineContractGroup().namespace("agents").responses({
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

// The device-approval page's read: the agent id comes from the verification
// link the agent hands its user, and only pending agents resolve. Approval
// itself still requires the user code, checked by the agent-auth plugin.
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
