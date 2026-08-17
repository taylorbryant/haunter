import {
	defineContractGroup,
	defineQueryTransport,
	query,
} from "@beignet/core/contracts";
import { z } from "zod";
import { errors } from "@/features/shared/errors";
import { ErrorResponseSchema } from "@/features/shared/schemas";
import {
	BulkUpdateTasksInputSchema,
	BulkUpdateTasksOutputSchema,
	CreateTaskInputSchema,
	DueDateSchema,
	ListTasksOutputSchema,
	TaskFilterSchema,
	TaskIdInputSchema,
	TaskNotificationActionBodySchema,
	TaskNotificationActionOutputSchema,
	TaskSchema,
	TaskScopeSchema,
	UpdateTaskBodySchema,
} from "@/features/tasks/schemas";

const tasks = defineContractGroup()
	.namespace("tasks")
	.meta({ auth: "required" })
	.errors({ Unauthorized: errors.Unauthorized })
	.responses({
		500: ErrorResponseSchema,
	});

export const listTasks = tasks
	.get("/api/workspaces/:workspaceId/tasks")
	.pathParams(z.object({ workspaceId: z.string().min(1) }))
	.query(
		z.object({
			filter: TaskFilterSchema.optional(),
			scope: TaskScopeSchema.optional(),
			dueOnOrAfter: DueDateSchema.optional(),
			dueOnOrBefore: DueDateSchema.optional(),
			limit: z.number().int().min(1).max(200).optional(),
		}),
		defineQueryTransport({
			filter: query.string(),
			scope: query.string(),
			dueOnOrAfter: query.string(),
			dueOnOrBefore: query.string(),
			limit: query.integer(),
		}),
	)
	.errors({
		Forbidden: errors.Forbidden,
		WorkspaceNotFound: errors.WorkspaceNotFound,
	})
	.responses({
		200: ListTasksOutputSchema,
	});

export const createTask = tasks
	.post("/api/tasks")
	.body(CreateTaskInputSchema)
	.meta({ idempotency: { header: "idempotency-key", scope: "actor" } })
	.errors({
		Forbidden: errors.Forbidden,
		WorkspaceNotFound: errors.WorkspaceNotFound,
	})
	.responses({
		201: TaskSchema,
	});

export const updateTask = tasks
	.patch("/api/tasks/:id")
	.pathParams(TaskIdInputSchema)
	.body(UpdateTaskBodySchema)
	.errors({
		Forbidden: errors.Forbidden,
		InvalidTaskDue: errors.InvalidTaskDue,
		StaleWrite: errors.StaleWrite,
		TaskNotFound: errors.TaskNotFound,
		TaskNotEditable: errors.TaskNotEditable,
	})
	.responses({
		200: TaskSchema,
	});

export const bulkUpdateTasks = tasks
	.patch("/api/tasks/bulk")
	.body(BulkUpdateTasksInputSchema)
	.errors({
		Forbidden: errors.Forbidden,
		InvalidTaskDue: errors.InvalidTaskDue,
		StaleWrite: errors.StaleWrite,
		TaskNotFound: errors.TaskNotFound,
	})
	.responses({
		200: BulkUpdateTasksOutputSchema,
	});

export const deleteTask = tasks
	.delete("/api/tasks/:id")
	.pathParams(TaskIdInputSchema)
	.errors({
		Forbidden: errors.Forbidden,
		TaskNotFound: errors.TaskNotFound,
		TaskNotEditable: errors.TaskNotEditable,
	})
	.responses({
		204: null,
	});

export const actOnTaskNotification = tasks
	.post("/api/task-notifications/:id/action")
	.pathParams(TaskIdInputSchema)
	.body(TaskNotificationActionBodySchema)
	.meta({ idempotency: { header: "idempotency-key", scope: "actor" } })
	.errors({
		Forbidden: errors.Forbidden,
		NotificationNotFound: errors.NotificationNotFound,
		NotificationNotActionable: errors.NotificationNotActionable,
		StaleWrite: errors.StaleWrite,
	})
	.responses({
		200: TaskNotificationActionOutputSchema,
	});
