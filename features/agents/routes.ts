import "@beignet/core/server-only";
import {
	authorizeMcpConnection,
	disconnectMcpConnection,
	getMcpConsentContext,
	getPendingAgent,
	listAgentActivity,
	listAgents,
} from "@/features/agents/contracts";
import {
	authorizeMcpConnectionUseCase,
	disconnectMcpConnectionUseCase,
	getMcpConsentContextUseCase,
	getPendingAgentUseCase,
	listAgentActivityUseCase,
	listAgentsUseCase,
} from "@/features/agents/use-cases";
import { defineRouteGroup } from "@/lib/routes";
import { routeAuth } from "@/lib/route-auth";

export const agentRoutes = defineRouteGroup({
	name: "agents",
	hooks: [routeAuth.required()],
	routes: [
		{ contract: listAgents, useCase: listAgentsUseCase },
		{ contract: listAgentActivity, useCase: listAgentActivityUseCase },
		{ contract: getPendingAgent, useCase: getPendingAgentUseCase },
		{
			contract: getMcpConsentContext,
			useCase: getMcpConsentContextUseCase,
		},
		{
			contract: authorizeMcpConnection,
			useCase: authorizeMcpConnectionUseCase,
		},
		{
			contract: disconnectMcpConnection,
			useCase: disconnectMcpConnectionUseCase,
		},
	],
});
