import {
	type BroadcastRefreshGate,
	createBroadcastMutationRefreshGate,
} from "@beignet/react-query";
import { matchQuery, type QueryClient } from "@tanstack/react-query";
import { rq } from "@/client";
import { taskWriteLock } from "@/features/tasks/client/completion-lock";
import { listTasks } from "@/features/tasks/contracts";

export function createWorkspaceRefreshGate(
	queryClient: QueryClient,
	writeLock = taskWriteLock,
): BroadcastRefreshGate {
	// Preserve the existing barrier: unkeyed mutations cannot yet be scoped safely.
	const mutations = createBroadcastMutationRefreshGate({
		queryClient,
		mutations: {},
	});
	return {
		isBlocked: (query) =>
			mutations.isBlocked(query) ||
			(matchQuery(rq(listTasks).filter(), query) &&
				writeLock.hasPendingWrites()),
		subscribe(onChange) {
			const stopMutations = mutations.subscribe(onChange);
			const stopWrites = writeLock.subscribe(onChange);
			return () => {
				stopWrites();
				stopMutations();
			};
		},
	};
}
