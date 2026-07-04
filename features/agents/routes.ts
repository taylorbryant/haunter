import "@beignet/core/server-only";
import { defineRouteGroup } from "@beignet/next";
import type { AppContext } from "@/app-context";
import { getPendingAgent, listAgents } from "@/features/agents/contracts";
import {
	getPendingAgentUseCase,
	listAgentsUseCase,
} from "@/features/agents/use-cases";

export const agentRoutes = defineRouteGroup<AppContext>()({
	name: "agents",
	routes: [
		{ contract: listAgents, useCase: listAgentsUseCase },
		{ contract: getPendingAgent, useCase: getPendingAgentUseCase },
	],
});
