import type { QueryClient } from "@tanstack/react-query";
import { rq } from "@/client";
import { getPendingAgent, listAgents } from "@/features/agents/contracts";

export function listAgentsQueryOptions() {
	return rq(listAgents).queryOptions({});
}

export function getPendingAgentQueryOptions(agentId: string) {
	return rq(getPendingAgent).queryOptions({ path: { agentId } });
}

export function invalidateAgents(queryClient: QueryClient) {
	return rq(listAgents).invalidate(queryClient, {});
}
