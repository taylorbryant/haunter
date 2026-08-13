import "@beignet/core/server-only";
import {
	actOnTaskNotification,
	createTask,
	deleteTask,
	listTasks,
	updateTask,
} from "@/features/tasks/contracts";
import {
	actOnTaskNotificationUseCase,
	createTaskUseCase,
	deleteTaskUseCase,
	listTasksUseCase,
	updateTaskUseCase,
} from "@/features/tasks/use-cases";
import { defineRouteGroup } from "@/lib/routes";
import { routeAuth } from "@/lib/route-auth";

export const taskRoutes = defineRouteGroup({
	name: "tasks",
	hooks: [routeAuth.required()],
	routes: [
		{
			contract: actOnTaskNotification,
			useCase: actOnTaskNotificationUseCase,
		},
		{ contract: listTasks, useCase: listTasksUseCase },
		{ contract: createTask, useCase: createTaskUseCase },
		{ contract: updateTask, useCase: updateTaskUseCase },
		{ contract: deleteTask, useCase: deleteTaskUseCase },
	],
});
