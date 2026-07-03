import { z } from "zod";

const DueDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, {
	message: "Due date must be YYYY-MM-DD",
});

export const TaskSchema = z.object({
	id: z.string().uuid(),
	userId: z.string(),
	workspaceId: z.string().uuid(),
	pageId: z.string().uuid().nullable(),
	sourceBlockId: z.string().nullable(),
	title: z.string(),
	completed: z.boolean(),
	dueDate: DueDateSchema.nullable(),
	completedAt: z.string().datetime().nullable(),
	createdAt: z.string().datetime(),
	updatedAt: z.string().datetime(),
});

export const TaskWithPageSchema = TaskSchema.extend({
	pageTitle: z.string().nullable(),
});

export const TaskFilterSchema = z
	.enum(["open", "completed", "all"])
	.default("open");

export const ListTasksInputSchema = z.object({
	workspaceId: z.string().uuid(),
	filter: TaskFilterSchema,
});

export const ListTasksOutputSchema = z.object({
	items: z.array(TaskWithPageSchema),
});

export const TaskIdInputSchema = z.object({
	id: z.string().uuid(),
});

export const CreateTaskInputSchema = z.object({
	workspaceId: z.string().uuid(),
	title: z.string().min(1).max(300),
	dueDate: DueDateSchema.optional(),
});

export const UpdateTaskBodySchema = z.object({
	completed: z.boolean().optional(),
	dueDate: DueDateSchema.nullable().optional(),
	title: z.string().min(1).max(300).optional(),
});

export const UpdateTaskInputSchema =
	TaskIdInputSchema.merge(UpdateTaskBodySchema);

export const DeleteTaskOutputSchema = z.void();

export type Task = z.infer<typeof TaskSchema>;
export type TaskWithPage = z.infer<typeof TaskWithPageSchema>;
export type TaskFilter = z.infer<typeof TaskFilterSchema>;
export type CreateTaskInput = z.infer<typeof CreateTaskInputSchema>;
export type UpdateTaskInput = z.infer<typeof UpdateTaskInputSchema>;
