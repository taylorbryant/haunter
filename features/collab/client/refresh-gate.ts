import {
	type BroadcastRefreshGate,
	createBroadcastMutationRefreshGate,
} from "@beignet/react-query";
import type { QueryClient } from "@tanstack/react-query";
import {
	taskWriteBlocksQuery,
	taskWriteIdentity,
} from "@/features/tasks/client/write-state";

export function createWorkspaceRefreshGate(
	queryClient: QueryClient,
): BroadcastRefreshGate {
	// Unmigrated mutations retain their conservative barrier. Task mutations
	// declare their affected queries and only hold those projections.
	const others = createBroadcastMutationRefreshGate({
		queryClient,
		mutations: { predicate: (mutation) => !taskWriteIdentity(mutation) },
	});
	return {
		isBlocked: (query) =>
			others.isBlocked(query) || taskWriteBlocksQuery(queryClient, query),
		subscribe: (onChange) => others.subscribe(onChange),
	};
}
