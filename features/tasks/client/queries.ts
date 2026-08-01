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
