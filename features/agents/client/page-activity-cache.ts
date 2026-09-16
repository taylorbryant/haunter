import type { QueryClient } from "@tanstack/react-query";
import {
	PAGE_AGENT_ACTIVE_TTL_MS,
	PAGE_AGENT_RECENT_TTL_MS,
	type PageAgentActivity,
} from "@/features/agents/page-activity";
import {
	estimatedWorkspaceServerTime,
	type WorkspaceEventClock,
} from "@/features/collab/client/event-clock";

/** Deadlines use performance.now(); server timestamps are only for ordering/age. */
export type CachedPageAgentActivity = PageAgentActivity & {
	expiresAt: number;
	retainUntil: number;
};

export function pageAgentActivityKey(userId: string, workspaceId: string) {
	return ["page-agent-activity", userId, workspaceId] as const;
}

export function mergePageAgentActivity(
	current: readonly CachedPageAgentActivity[],
	event: PageAgentActivity,
	clock: WorkspaceEventClock,
	now = performance.now(),
): CachedPageAgentActivity[] {
	// Retain terminal records briefly after they disappear to reject late starts.
	// Prune by deadline only: workspace bursts must not evict active operations
	// or the terminal records that prevent delayed starts from reviving them.
	const entries = current.filter((item) => item.retainUntil > now);
	// Network latency in the reference can make a fresh event look slightly ahead.
	const ageMs = Math.max(
		0,
		estimatedWorkspaceServerTime(clock, now) - Date.parse(event.occurredAt),
	);
	// Completion still ends the operation after its 15-second display window.
	// Keep it for the active lifetime so delayed starts cannot revive it.
	if (ageMs >= PAGE_AGENT_ACTIVE_TTL_MS) return entries;
	const previous = entries.find(
		(item) => item.operationId === event.operationId,
	);
	if (
		previous &&
		(previous.phase !== "active" ||
			(previous.phase === event.phase &&
				previous.occurredAt === event.occurredAt) ||
			Date.parse(previous.occurredAt) > Date.parse(event.occurredAt))
	)
		return entries;
	return [
		...entries.filter((item) => item.operationId !== event.operationId),
		{
			...event,
			expiresAt:
				now +
				(event.phase === "active"
					? PAGE_AGENT_ACTIVE_TTL_MS
					: PAGE_AGENT_RECENT_TTL_MS) -
				ageMs,
			retainUntil: now + PAGE_AGENT_ACTIVE_TTL_MS - ageMs,
		},
	];
}

/** One participant per connection; concurrent active calls take precedence. */
export function visiblePageAgents(
	activities: readonly CachedPageAgentActivity[],
	pageId: string,
	now = performance.now(),
): PageAgentActivity[] {
	const byAgent = new Map<string, PageAgentActivity>();
	const sorted = activities
		.filter((item) => item.pageId === pageId && item.expiresAt > now)
		.toSorted(
			(a, b) =>
				Number(b.phase === "active") - Number(a.phase === "active") ||
				Date.parse(b.occurredAt) - Date.parse(a.occurredAt),
		);
	for (const item of sorted) {
		if (!byAgent.has(item.agentId)) byAgent.set(item.agentId, item);
	}
	return [...byAgent.values()];
}

export function receivePageAgentActivity(
	queryClient: QueryClient,
	userId: string,
	workspaceId: string,
	event: PageAgentActivity,
	clock: WorkspaceEventClock,
) {
	if (event.workspaceId !== workspaceId) return;
	queryClient.setQueryData<CachedPageAgentActivity[]>(
		pageAgentActivityKey(userId, workspaceId),
		(current = []) => mergePageAgentActivity(current, event, clock),
	);
}

export function clearPageAgentActivity(
	queryClient: QueryClient,
	userId: string,
	workspaceId: string,
) {
	queryClient.setQueryData(pageAgentActivityKey(userId, workspaceId), []);
}
