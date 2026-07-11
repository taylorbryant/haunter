import "@beignet/core/server-only";
import { defineRouteGroup } from "@beignet/core/server";
import type { AppContext } from "@/app-context";
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

export const agentRoutes = defineRouteGroup<AppContext>()({
	name: "agents",
	routes: [
		{ contract: listAgents, useCase: listAgentsUseCase },
		{ contract: listAgentActivity, useCase: listAgentActivityUseCase },
		{ contract: getPendingAgent, useCase: getPendingAgentUseCase },
	],
});
