import type { QueryClient } from "@tanstack/react-query";
import {
	CANVAS_AGENT_ACTIVE_TTL_MS,
	CANVAS_AGENT_RECENT_TTL_MS,
	CANVAS_AGENT_HIGHLIGHT_TTL_MS,
	type CanvasAgentActivity,
} from "../canvas-activity";
import {
	estimatedWorkspaceServerTime,
	type WorkspaceEventClock,
} from "@/features/collab/client/event-clock";

export type CachedCanvasAgentActivity = CanvasAgentActivity & {
	expiresAt: number;
	retainUntil: number;
	highlightUntil: number;
};
export const canvasAgentActivityKey = (userId: string, workspaceId: string) =>
	["canvas-agent-activity", userId, workspaceId] as const;

export function mergeCanvasAgentActivity(
	current: readonly CachedCanvasAgentActivity[],
	event: CanvasAgentActivity,
	clock: WorkspaceEventClock,
	now = performance.now(),
): CachedCanvasAgentActivity[] {
	const entries = current.filter((item) => item.retainUntil > now);
	const ageMs = Math.max(
		0,
		estimatedWorkspaceServerTime(clock, now) - Date.parse(event.occurredAt),
	);
	if (ageMs >= CANVAS_AGENT_ACTIVE_TTL_MS) return entries;
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
					? CANVAS_AGENT_ACTIVE_TTL_MS
					: CANVAS_AGENT_RECENT_TTL_MS) -
				ageMs,
			retainUntil: now + CANVAS_AGENT_ACTIVE_TTL_MS - ageMs,
			highlightUntil:
				event.phase === "completed" && event.action === "edit"
					? now + CANVAS_AGENT_HIGHLIGHT_TTL_MS - ageMs
					: now,
		},
	];
}

export function canvasActivitySnapshot(
	activities: readonly CachedCanvasAgentActivity[],
	canvasId: string,
	now = performance.now(),
) {
	const visible = activities
		.filter((item) => item.canvasId === canvasId && item.expiresAt > now)
		.toSorted(
			(a, b) =>
				Number(b.phase === "active") - Number(a.phase === "active") ||
				Date.parse(b.occurredAt) - Date.parse(a.occurredAt),
		);
	const byAgent = new Map<string, CanvasAgentActivity>();
	for (const item of visible)
		if (!byAgent.has(item.agentId)) byAgent.set(item.agentId, item);
	return {
		agents: [...byAgent.values()],
		// Every concurrent completion contributes, even while the same agent is
		// performing another operation. These never become the user's selection.
		shapeIds: [
			...new Set(
				visible
					.filter((item) => item.highlightUntil > now)
					.flatMap((item) => item.changedShapeIds),
			),
		],
		nextExpiry: Math.min(
			...visible
				.flatMap((item) => [item.expiresAt, item.highlightUntil])
				.filter((expiry) => expiry > now),
		),
	};
}

export function receiveCanvasAgentActivity(
	queryClient: QueryClient,
	userId: string,
	workspaceId: string,
	event: CanvasAgentActivity,
	clock: WorkspaceEventClock,
) {
	if (event.workspaceId !== workspaceId) return;
	queryClient.setQueryData<CachedCanvasAgentActivity[]>(
		canvasAgentActivityKey(userId, workspaceId),
		(current = []) => mergeCanvasAgentActivity(current, event, clock),
	);
}
export function clearCanvasAgentActivity(
	queryClient: QueryClient,
	userId: string,
	workspaceId: string,
) {
	queryClient.setQueryData(canvasAgentActivityKey(userId, workspaceId), []);
}
