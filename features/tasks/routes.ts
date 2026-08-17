import "@beignet/core/server-only";
import {
	actOnTaskNotification,
	bulkUpdateTasks,
	createTask,
	deleteTask,
	listTasks,
	updateTask,
} from "@/features/tasks/contracts";
import {
	actOnTaskNotificationUseCase,
	bulkUpdateTasksUseCase,
	createTaskUseCase,
	deleteTaskUseCase,
	listTasksUseCase,
	updateTaskUseCase,
} from "@/features/tasks/use-cases";
import { routeAuth } from "@/lib/route-auth";
import { defineRouteGroup } from "@/lib/routes";

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
		{ contract: bulkUpdateTasks, useCase: bulkUpdateTasksUseCase },
		{ contract: updateTask, useCase: updateTaskUseCase },
		{ contract: deleteTask, useCase: deleteTaskUseCase },
	],
});
