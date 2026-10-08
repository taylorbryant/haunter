import type { QueryClient } from "@tanstack/react-query";
import { rq } from "@/client";
import { protectedRefetchInterval } from "@/client/session-recovery";
import { searchWorkspace } from "../contracts";
import type { SearchKind } from "../schemas";

export function searchWorkspaceQueryOptions(
	workspaceId: string,
	query: string,
	kind: SearchKind,
) {
	return rq(searchWorkspace).infiniteQueryOptions({
		path: { workspaceId },
		query: { query, kind, limit: 20 },
		initialPageParam: undefined as string | undefined,
		page: ({ pageParam }) => ({
			query: { query, kind, limit: 20, cursor: pageParam },
		}),
		getNextPageParam: (last) => last.nextCursor ?? undefined,
		refetchInterval: protectedRefetchInterval,
		// Opening search or returning to a previous query must include newly saved edits.
		staleTime: 0,
	});
}

export function invalidateWorkspaceSearch(
	queryClient: QueryClient,
	workspaceId?: string,
) {
	return rq(searchWorkspace).invalidate(
		queryClient,
		workspaceId ? { path: { workspaceId } } : undefined,
	);
}
