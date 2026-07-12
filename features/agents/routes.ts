import "@beignet/core/server-only";
import {
	getPendingAgent,
	listAgentActivity,
	listAgents,
} from "@/features/agents/contracts";
import {
	getPendingAgentUseCase,
	listAgentActivityUseCase,
	listAgentsUseCase,
} from "@/features/agents/use-cases";
import { defineRouteGroup } from "@/lib/routes";
import { routeAuth } from "@/server/auth-hooks";

export const agentRoutes = defineRouteGroup({
	name: "agents",
	hooks: [routeAuth.required()],
	routes: [
		{ contract: listAgents, useCase: listAgentsUseCase },
		{ contract: listAgentActivity, useCase: listAgentActivityUseCase },
		{ contract: getPendingAgent, useCase: getPendingAgentUseCase },
	],
});
