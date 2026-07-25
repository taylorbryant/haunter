import type { QueryClient } from "@tanstack/react-query";
import { rq } from "@/client";
import {
	getPendingAgent,
	listAgentActivity,
	listAgents,
} from "@/features/agents/contracts";

export function listAgentsQueryOptions() {
	return rq(listAgents).queryOptions({});
}

export function listAgentActivityQueryOptions(limit = 25) {
	return rq(listAgentActivity).queryOptions({ query: { limit } });
}

export function getPendingAgentQueryOptions(agentId: string) {
	return rq(getPendingAgent).queryOptions({ path: { agentId } });
}

export function invalidateAgents(queryClient: QueryClient) {
	return rq(listAgents).invalidate(queryClient, {});
}

export function invalidateAgentActivity(queryClient: QueryClient) {
	return rq(listAgentActivity).invalidate(queryClient, {});
}
