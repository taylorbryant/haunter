import "@beignet/core/server-only";
import { defineRouteGroup } from "@beignet/core/server";
import type { AppContext } from "@/app-context";
import {
	createTask,
	deleteTask,
	listTasks,
	updateTask,
} from "@/features/tasks/contracts";
import {
	createTaskUseCase,
	deleteTaskUseCase,
	listTasksUseCase,
	updateTaskUseCase,
} from "@/features/tasks/use-cases";

export const taskRoutes = defineRouteGroup<AppContext>()({
	name: "tasks",
	routes: [
		{ contract: listTasks, useCase: listTasksUseCase },
		{ contract: createTask, useCase: createTaskUseCase },
		{ contract: updateTask, useCase: updateTaskUseCase },
		{ contract: deleteTask, useCase: deleteTaskUseCase },
	],
});
