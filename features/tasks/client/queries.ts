import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { rq } from "@/client";
import {
	actOnTaskNotification,
	createTask,
	deleteTask,
	listTasks,
	updateTask,
} from "@/features/tasks/contracts";
import type {
	ListTasksOutput,
	TaskFilter,
	TaskScope,
	TaskWithPage,
} from "@/features/tasks/schemas";

export type TaskCompletionCacheSnapshot = Array<{
	queryKey: QueryKey;
	previousIndex: number;
	previousTask: TaskWithPage;
}>;

export type TaskCreationCacheSnapshot = Array<{
	queryKey: QueryKey;
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

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function taskFilterFromQueryKey(queryKey: QueryKey): TaskFilter | null {
	const params = queryKey.at(-1);
	if (!isRecord(params) || !isRecord(params.query)) return null;
	const filter = params.query.filter;
	return filter === "open" || filter === "completed" || filter === "all"
		? filter
		: null;
}

function listTasksParamsFromQueryKey(queryKey: QueryKey) {
	const params = queryKey.at(-1);
	if (!isRecord(params) || !isRecord(params.path) || !isRecord(params.query)) {
		return null;
	}
	const workspaceId = params.path.workspaceId;
	const filter = params.query.filter;
	const scope = params.query.scope;
	const limit = params.query.limit;
	if (
		typeof workspaceId !== "string" ||
		(filter !== "open" && filter !== "completed" && filter !== "all") ||
		(scope !== "mine" && scope !== "everyone") ||
		typeof limit !== "number"
	) {
		return null;
	}
	return {
		workspaceId,
		filter,
		scope,
		limit,
		dueOnOrAfter:
			typeof params.query.dueOnOrAfter === "string"
				? params.query.dueOnOrAfter
				: undefined,
		dueOnOrBefore:
			typeof params.query.dueOnOrBefore === "string"
				? params.query.dueOnOrBefore
				: undefined,
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
	params: NonNullable<ReturnType<typeof listTasksParamsFromQueryKey>>,
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
		refetchInterval: 30_000,
	};
}

export function createTaskMutationOptions() {
	return rq(createTask).mutationOptions();
}

export function actOnTaskNotificationMutationOptions() {
	return rq(actOnTaskNotification).mutationOptions();
}

export function updateTaskMutationOptions() {
	return rq(updateTask).mutationOptions();
}

export function deleteTaskMutationOptions() {
	return rq(deleteTask).mutationOptions();
}

export function invalidateTasks(queryClient: QueryClient) {
	return rq(listTasks).invalidate(queryClient);
}

export async function optimisticallyAddTask(
	queryClient: QueryClient,
	task: TaskWithPage,
	currentUserId: string,
): Promise<TaskCreationCacheSnapshot> {
	const queryFilter = rq(listTasks).filter();
	await queryClient.cancelQueries(queryFilter, {
		revert: false,
		silent: true,
	});
	const cachedQueries =
		queryClient.getQueriesData<ListTasksOutput>(queryFilter);
	const snapshot: TaskCreationCacheSnapshot = [];

	for (const [queryKey, current] of cachedQueries) {
		const params = listTasksParamsFromQueryKey(queryKey);
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
	queryClient.setQueriesData<ListTasksOutput>(
		rq(listTasks).filter(),
		(current) => {
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
	);
}

export function restoreTaskCreationCache(
	queryClient: QueryClient,
	temporaryTaskId: string,
	snapshot: TaskCreationCacheSnapshot,
) {
	for (const { queryKey, previousHasMore, displacedTask } of snapshot) {
		queryClient.setQueryData<ListTasksOutput>(queryKey, (current) => {
			if (!current) return current;
			const params = listTasksParamsFromQueryKey(queryKey);
			if (!params) return current;
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
				items: items.slice(0, params.limit),
				hasMore: previousHasMore || items.length > params.limit,
			};
		});
	}
}

export async function optimisticallySetTaskCompletion(
	queryClient: QueryClient,
	taskId: string,
	completed: boolean,
): Promise<TaskCompletionCacheSnapshot> {
	const queryFilter = rq(listTasks).filter();
	await queryClient.cancelQueries(queryFilter, {
		revert: false,
		silent: true,
	});
	const cachedQueries =
		queryClient.getQueriesData<ListTasksOutput>(queryFilter);
	const snapshot: TaskCompletionCacheSnapshot = [];
	const completedAt = completed ? new Date().toISOString() : null;

	for (const [queryKey, current] of cachedQueries) {
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
		snapshot.push({ queryKey, previousIndex, previousTask });
		const filter = taskFilterFromQueryKey(queryKey);
		const shouldRemove =
			(filter === "open" && completed) ||
			(filter === "completed" && !completed);
		queryClient.setQueryData<ListTasksOutput>(queryKey, {
			...current,
			items: shouldRemove
				? current.items.filter((task) => task.id !== taskId)
				: current.items.map((task) =>
						task.id === taskId ? { ...task, completed, completedAt } : task,
					),
		});
	}

	return snapshot;
}

export function restoreTasksCache(
	queryClient: QueryClient,
	snapshot: TaskCompletionCacheSnapshot,
) {
	for (const { queryKey, previousIndex, previousTask } of snapshot) {
		queryClient.setQueryData<ListTasksOutput>(queryKey, (current) => {
			if (!current) return current;
			const items = [...current.items];
			const currentIndex = items.findIndex(
				(task) => task.id === previousTask.id,
			);
			if (currentIndex >= 0) {
				items[currentIndex] = previousTask;
			} else {
				items.splice(Math.min(previousIndex, items.length), 0, previousTask);
			}
			return { ...current, items };
		});
	}
}
