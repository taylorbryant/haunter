import type { ContractCacheParams } from "@beignet/react-query";
import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { rq } from "@/client";
import { protectedRefetchInterval } from "@/client/session-recovery";
import { listTasks } from "@/features/tasks/contracts";
import type {
	ListTasksOutput,
	TaskFilter,
	TaskScope,
	TaskWithPage,
} from "@/features/tasks/schemas";
import { refreshAfterTaskWrites } from "./refresh";

export type TaskCacheSnapshot = Array<{
	queryKey: QueryKey;
	previousIndex: number;
	previousTask: TaskWithPage;
	optimisticTask: TaskWithPage | null;
	changedFields: Array<keyof TaskWithPage>;
}>;

export type TaskCreationCacheSnapshot = Array<{
	queryKey: QueryKey;
	limit: number;
	previousHasMore: boolean;
	displacedTask: TaskWithPage | null;
}>;

const OPTIMISTIC_TASK_ID_PREFIX = "optimistic:";

export function createOptimisticTaskId() {
	return `${OPTIMISTIC_TASK_ID_PREFIX}${crypto.randomUUID()}`;
}

export function isOptimisticTaskId(taskId: string) {
	return taskId.startsWith(OPTIMISTIC_TASK_ID_PREFIX);
}

function listTasksCacheParams(
	params: ContractCacheParams<typeof listTasks.config>,
) {
	const workspaceId = params.path?.workspaceId;
	const { filter, scope, limit, dueOnOrAfter, dueOnOrBefore } =
		params.query ?? {};
	// Cache identities can be partial. Only infer list membership when the
	// caller explicitly keyed the filters and limit, as our query options do.
	if (
		workspaceId === undefined ||
		filter === undefined ||
		scope === undefined ||
		limit === undefined
	) {
		return null;
	}
	return {
		workspaceId,
		filter,
		scope,
		limit,
		dueOnOrAfter,
		dueOnOrBefore,
	};
}

function compareListedTasks(left: TaskWithPage, right: TaskWithPage) {
	if (left.dueDate === null && right.dueDate !== null) return 1;
	if (left.dueDate !== null && right.dueDate === null) return -1;
	const dateOrder = (left.dueDate ?? "").localeCompare(right.dueDate ?? "");
	if (dateOrder !== 0) return dateOrder;
	if (left.dueTime === null && right.dueTime !== null) return 1;
	if (left.dueTime !== null && right.dueTime === null) return -1;
	const timeOrder = (left.dueTime ?? "").localeCompare(right.dueTime ?? "");
	return timeOrder !== 0
		? timeOrder
		: left.createdAt.localeCompare(right.createdAt);
}

function taskMatchesListQuery(
	task: TaskWithPage,
	currentUserId: string,
	params: NonNullable<ReturnType<typeof listTasksCacheParams>>,
) {
	if (task.workspaceId !== params.workspaceId) return false;
	if (params.filter === "open" && task.completed) return false;
	if (params.filter === "completed" && !task.completed) return false;
	if (params.scope === "mine" && task.assigneeId !== currentUserId)
		return false;
	if (
		params.dueOnOrAfter &&
		(task.dueDate === null || task.dueDate < params.dueOnOrAfter)
	) {
		return false;
	}
	if (
		params.dueOnOrBefore &&
		(task.dueDate === null || task.dueDate > params.dueOnOrBefore)
	) {
		return false;
	}
	return true;
}

export function listTasksQueryOptions(
	workspaceId: string,
	filter: TaskFilter,
	scope: TaskScope = "everyone",
	limit = 50,
	options: { dueOnOrAfter?: string; dueOnOrBefore?: string } = {},
) {
	return {
		...rq(listTasks).queryOptions({
			path: { workspaceId },
			query: { filter, scope, limit, ...options },
		}),
		// Shared workspaces: pick up other members' changes without a manual
		// reload. Paused automatically while the tab is in the background.
		refetchOnMount: false,
		refetchInterval: protectedRefetchInterval,
	};
}

export function invalidateTasks(
	queryClient: QueryClient,
	workspaceId?: string,
) {
	return refreshAfterTaskWrites(queryClient, [
		rq(listTasks).filter(workspaceId ? { path: { workspaceId } } : undefined),
	]);
}

export const invalidateTasksWhenIdle = invalidateTasks;

export async function optimisticallyAddTask(
	queryClient: QueryClient,
	task: TaskWithPage,
	currentUserId: string,
): Promise<TaskCreationCacheSnapshot> {
	const queryFilter = rq(listTasks).filter({
		path: { workspaceId: task.workspaceId },
	});
	// Default cancellation returns the query to idle and preserves manual cache
	// edits, so refreshAfterTaskWrites can reconcile once the write settles.
	await queryClient.cancelQueries(queryFilter);
	const cachedQueries = rq(listTasks).cacheEntries(queryClient);
	const snapshot: TaskCreationCacheSnapshot = [];

	for (const {
		queryKey,
		data: current,
		params: cacheParams,
	} of cachedQueries) {
		const params = listTasksCacheParams(cacheParams);
		if (
			!current ||
			!params ||
			!taskMatchesListQuery(task, currentUserId, params) ||
			current.items.some((item) => item.id === task.id)
		) {
			continue;
		}
		const sorted = [...current.items, task].sort(compareListedTasks);
		const items = sorted.slice(0, params.limit);
		const displacedTask =
			current.items.find(
				(item) => !items.some((visible) => visible.id === item.id),
			) ?? null;
		const hasMore = current.hasMore || sorted.length > params.limit;
		snapshot.push({
			queryKey,
			previousHasMore: current.hasMore,
			limit: params.limit,
			displacedTask,
		});
		queryClient.setQueryData<ListTasksOutput>(queryKey, {
			...current,
			items,
			hasMore,
		});
	}

	return snapshot;
}

export function replaceOptimisticTask(
	queryClient: QueryClient,
	temporaryTaskId: string,
	createdTask: TaskWithPage,
) {
	rq(listTasks).updateCachedQueries(queryClient, {
		update: ({ data: current }) => {
			if (!current?.items.some((task) => task.id === temporaryTaskId)) {
				return current;
			}
			return {
				...current,
				items: current.items
					.map((task) => (task.id === temporaryTaskId ? createdTask : task))
					.sort(compareListedTasks),
			};
		},
	});
}

export function restoreTaskCreationCache(
	queryClient: QueryClient,
	temporaryTaskId: string,
	snapshot: TaskCreationCacheSnapshot,
) {
	for (const { queryKey, limit, previousHasMore, displacedTask } of snapshot) {
		queryClient.setQueryData<ListTasksOutput>(queryKey, (current) => {
			if (!current) return current;
			const items = current.items.filter((task) => task.id !== temporaryTaskId);
			if (
				displacedTask &&
				!items.some((task) => task.id === displacedTask.id)
			) {
				items.push(displacedTask);
				items.sort(compareListedTasks);
			}
			return {
				...current,
				items: items.slice(0, limit),
				hasMore: previousHasMore || items.length > limit,
			};
		});
	}
}

export async function optimisticallyPatchTask(
	queryClient: QueryClient,
	taskId: string,
	patch: Partial<TaskWithPage>,
	currentUserId?: string,
	workspaceId?: string,
): Promise<TaskCacheSnapshot> {
	const queryFilter = rq(listTasks).filter(
		workspaceId ? { path: { workspaceId } } : undefined,
	);
	await queryClient.cancelQueries(queryFilter);
	const cachedQueries = rq(listTasks).cacheEntries(queryClient);
	const snapshot: TaskCacheSnapshot = [];
	const changedFields = Object.keys(patch) as Array<keyof TaskWithPage>;

	for (const {
		queryKey,
		data: current,
		params: cacheParams,
	} of cachedQueries) {
		const previousIndex = current?.items.findIndex(
			(task) => task.id === taskId,
		);
		if (
			current === undefined ||
			previousIndex === undefined ||
			previousIndex < 0
		) {
			continue;
		}
		const previousTask = current.items[previousIndex];
		if (!previousTask) continue;
		const nextTask = { ...previousTask, ...patch };
		const params = listTasksCacheParams(cacheParams);
		const shouldRemove = Boolean(
			params &&
				currentUserId &&
				!taskMatchesListQuery(nextTask, currentUserId, params),
		);
		snapshot.push({
			queryKey,
			previousIndex,
			previousTask,
			optimisticTask: shouldRemove ? null : nextTask,
			changedFields,
		});
		queryClient.setQueryData<ListTasksOutput>(queryKey, {
			...current,
			items: shouldRemove
				? current.items.filter((task) => task.id !== taskId)
				: current.items
						.map((task) => (task.id === taskId ? nextTask : task))
						.sort(compareListedTasks),
		});
	}

	return snapshot;
}

export async function optimisticallyRemoveTask(
	queryClient: QueryClient,
	taskId: string,
	workspaceId?: string,
): Promise<TaskCacheSnapshot> {
	const queryFilter = rq(listTasks).filter(
		workspaceId ? { path: { workspaceId } } : undefined,
	);
	await queryClient.cancelQueries(queryFilter);
	const snapshot: TaskCacheSnapshot = [];

	for (const { queryKey, data: current } of rq(listTasks).cacheEntries(
		queryClient,
	)) {
		const previousIndex = current?.items.findIndex(
			(task) => task.id === taskId,
		);
		if (
			current === undefined ||
			previousIndex === undefined ||
			previousIndex < 0
		) {
			continue;
		}
		const previousTask = current.items[previousIndex];
		if (!previousTask) continue;
		snapshot.push({
			queryKey,
			previousIndex,
			previousTask,
			optimisticTask: null,
			changedFields: [],
		});
		queryClient.setQueryData<ListTasksOutput>(queryKey, {
			...current,
			items: current.items.filter((task) => task.id !== taskId),
		});
	}

	return snapshot;
}

export function restoreTasksCache(
	queryClient: QueryClient,
	snapshot: TaskCacheSnapshot,
) {
	for (const {
		queryKey,
		previousIndex,
		previousTask,
		optimisticTask,
		changedFields,
	} of snapshot) {
		queryClient.setQueryData<ListTasksOutput>(queryKey, (current) => {
			if (!current) return current;
			const currentIndex = current.items.findIndex(
				(task) => task.id === previousTask.id,
			);
			if (currentIndex >= 0 && optimisticTask) {
				const currentTask = current.items[currentIndex];
				if (!currentTask) return current;
				const rollback = Object.fromEntries(
					changedFields
						.filter((field) => currentTask[field] === optimisticTask[field])
						.map((field) => [field, previousTask[field]]),
				) as Partial<TaskWithPage>;
				const items = current.items.map((task) =>
					task.id === previousTask.id ? { ...task, ...rollback } : task,
				);
				items.sort(compareListedTasks);
				return { ...current, items };
			}
			if (currentIndex >= 0) return current;
			// This mutation only changed fields on a row that was present. If a
			// newer operation removed it, restoring the older snapshot would
			// resurrect stale task state.
			if (optimisticTask !== null) return current;
			const items = [...current.items];
			items.splice(Math.min(previousIndex, items.length), 0, previousTask);
			items.sort(compareListedTasks);
			return { ...current, items };
		});
	}
}
