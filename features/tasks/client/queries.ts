import type { QueryClient } from "@tanstack/react-query";
import { rq } from "@/client";
import {
	createTask,
	deleteTask,
	listTasks,
	updateTask,
} from "@/features/tasks/contracts";
import type { TaskFilter, TaskScope } from "@/features/tasks/schemas";

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

export function updateTaskMutationOptions() {
	return rq(updateTask).mutationOptions();
}

export function deleteTaskMutationOptions() {
	return rq(deleteTask).mutationOptions();
}

export function invalidateTasks(queryClient: QueryClient) {
	return rq(listTasks).invalidate(queryClient);
}
