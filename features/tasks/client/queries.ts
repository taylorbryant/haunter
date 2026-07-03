import type { QueryClient } from "@tanstack/react-query";
import { rq } from "@/client";
import {
	createTask,
	deleteTask,
	listTasks,
	updateTask,
} from "@/features/tasks/contracts";
import type { TaskFilter } from "@/features/tasks/schemas";

export function listTasksQueryOptions(workspaceId: string, filter: TaskFilter) {
	return rq(listTasks).queryOptions({
		path: { workspaceId },
		query: { filter },
	});
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
