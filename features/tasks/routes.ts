import "@beignet/core/server-only";
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
import { defineRouteGroup } from "@/lib/routes";
import { routeAuth } from "@/server/auth-hooks";

export const taskRoutes = defineRouteGroup({
	name: "tasks",
	hooks: [routeAuth.required()],
	routes: [
		{ contract: listTasks, useCase: listTasksUseCase },
		{ contract: createTask, useCase: createTaskUseCase },
		{ contract: updateTask, useCase: updateTaskUseCase },
		{ contract: deleteTask, useCase: deleteTaskUseCase },
	],
});
