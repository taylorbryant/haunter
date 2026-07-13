import { defineContractGroup } from "@beignet/core/contracts";
import { z } from "zod";
import { errors } from "@/features/shared/errors";
import {
	CreateTaskInputSchema,
	DueDateSchema,
	ListTasksOutputSchema,
	TaskFilterSchema,
	TaskIdInputSchema,
	TaskScopeSchema,
	TaskSchema,
	UpdateTaskBodySchema,
} from "@/features/tasks/schemas";

const ErrorResponseSchema = z.object({
	code: z.string(),
	message: z.string(),
	requestId: z.string().optional(),
});

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
			limit: z.coerce.number().int().min(1).max(200).optional(),
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
		TaskNotFound: errors.TaskNotFound,
		TaskNotEditable: errors.TaskNotEditable,
	})
	.responses({
		200: TaskSchema,
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
