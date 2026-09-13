import {
	type Mutation,
	matchQuery,
	type QueryClient,
	type QueryFilters,
} from "@tanstack/react-query";
import { rq } from "@/client";
import { protectedRefetchInterval } from "@/client/session-recovery";
import { listNotifications } from "@/features/notifications/contracts";
import { getPage, getPageMetadata } from "@/features/pages/contracts";
import { listTasks } from "../contracts";

type CachedQuery = Parameters<typeof matchQuery>[1];

export const TASK_WRITE_KEY = ["task-write"] as const;
export type TaskWriteIdentity = {
	userId: string;
	workspaceId: string;
	taskId: string;
	pageId: string | null;
	notificationId?: string;
};

export function taskWriteIdentity(
	mutation: Mutation,
): TaskWriteIdentity | undefined {
	if (mutation.options.mutationKey?.[0] !== TASK_WRITE_KEY[0]) return undefined;
	return mutation.meta?.taskWrite as TaskWriteIdentity | undefined;
}

export function taskWriteQueries(
	identity: Pick<TaskWriteIdentity, "workspaceId" | "pageId">,
): QueryFilters[] {
	return [
		rq(listTasks).filter({ path: { workspaceId: identity.workspaceId } }),
		rq(listNotifications).filter(),
		...(identity.pageId
			? [
					rq(getPage).filter({ path: { id: identity.pageId } }),
					rq(getPageMetadata).filter({ path: { id: identity.pageId } }),
				]
			: []),
	];
}

export function taskWriteBlocksQuery(
	queryClient: QueryClient,
	query: CachedQuery,
): boolean {
	return queryClient
		.getMutationCache()
		.findAll({ mutationKey: TASK_WRITE_KEY, status: "pending" })
		.some((mutation) => {
			const identity = taskWriteIdentity(mutation);
			return (
				identity &&
				taskWriteQueries(identity).some((filter) => matchQuery(filter, query))
			);
		});
}

export function hasPendingTaskWrite(
	queryClient: QueryClient,
	userId: string,
	workspaceId: string,
	taskId: string,
) {
	return (
		queryClient.isMutating({
			mutationKey: [...TASK_WRITE_KEY, userId, workspaceId, taskId],
		}) > 0
	);
}

export function taskAwareRefetchOptions(queryClient: QueryClient) {
	return {
		refetchOnMount: (query: CachedQuery) =>
			!taskWriteBlocksQuery(queryClient, query),
		refetchInterval: (query: CachedQuery) =>
			taskWriteBlocksQuery(queryClient, query)
				? false
				: protectedRefetchInterval(),
		refetchOnWindowFocus: (query: CachedQuery) =>
			!taskWriteBlocksQuery(queryClient, query),
		refetchOnReconnect: (query: CachedQuery) =>
			!taskWriteBlocksQuery(queryClient, query),
	};
}
