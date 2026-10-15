import { z } from "zod";
import {
	DueDateSchema,
	DueTimeSchema,
	ReminderOffsetMinutesSchema,
} from "./scheduling";

export {
	DueDateSchema,
	DueTimeSchema,
	ReminderOffsetMinutesSchema,
	TASK_REMINDER_OFFSETS,
} from "./scheduling";

export const TASK_TITLE_MAX_LENGTH = 1_000;
export const TASK_TITLE_TOO_LONG_MESSAGE =
	"Task titles can be up to 1,000 characters.";

const TaskTitleInputSchema = z
	.string()
	.min(1)
	.max(TASK_TITLE_MAX_LENGTH, { message: TASK_TITLE_TOO_LONG_MESSAGE });

export const TaskSchema = z.object({
	id: z.string().uuid(),
	/** The member who created the task — not necessarily who it's for. */
	userId: z.string(),
	workspaceId: z.string().min(1),
	pageId: z.string().uuid().nullable(),
	sourceBlockId: z.string().nullable(),
	title: z.string(),
	completed: z.boolean(),
	dueDate: DueDateSchema.nullable(),
	dueTime: DueTimeSchema.nullable(),
	reminderOffsetMinutes: ReminderOffsetMinutesSchema.nullable(),
	/** The member responsible for the task; null when unassigned. */
	assigneeId: z.string().nullable(),
	completedAt: z.string().datetime().nullable(),
	createdAt: z.string().datetime(),
	updatedAt: z.string().datetime(),
});

export const TaskWithPageSchema = TaskSchema.extend({
	pageTitle: z.string().nullable(),
	/** Assignee display name, resolved at read time. */
	assigneeName: z.string().nullable(),
});

export const TaskFilterSchema = z
	.enum(["open", "completed", "all"])
	.default("open");

export const TaskScopeSchema = z.enum(["everyone", "mine"]).default("everyone");

export const ListTasksInputSchema = z
	.object({
		workspaceId: z.string().min(1),
		taskId: z.uuid().optional(),
		filter: TaskFilterSchema,
		scope: TaskScopeSchema,
		dueOnOrAfter: DueDateSchema.optional(),
		dueOnOrBefore: DueDateSchema.optional(),
		limit: z.number().int().min(1).max(200).default(50),
	})
	.refine(
		(input) =>
			!input.dueOnOrAfter ||
			!input.dueOnOrBefore ||
			input.dueOnOrAfter <= input.dueOnOrBefore,
		{
			message: "dueOnOrAfter must not be later than dueOnOrBefore",
			path: ["dueOnOrAfter"],
		},
	);

export const ListTasksOutputSchema = z.object({
	items: z.array(TaskWithPageSchema),
	hasMore: z.boolean(),
});

export const TaskIdInputSchema = z.object({
	id: z.string().uuid(),
});

export const CreateTaskInputSchema = z
	.object({
		workspaceId: z.string().min(1),
		title: TaskTitleInputSchema,
		dueDate: DueDateSchema.optional(),
		dueTime: DueTimeSchema.optional(),
		reminderOffsetMinutes: ReminderOffsetMinutesSchema.optional(),
		// Omitted = assign to the creator (quick-add is "a task for me").
		// Explicit null = create unassigned.
		assigneeId: z.string().nullable().optional(),
	})
	.refine(
		(input) => input.dueTime === undefined || input.dueDate !== undefined,
		{
			message: "A due date is required when a due time is set",
			path: ["dueDate"],
		},
	)
	.refine(
		(input) =>
			input.reminderOffsetMinutes === undefined || input.dueDate !== undefined,
		{
			message: "A due date is required when a reminder is set",
			path: ["dueDate"],
		},
	);

export const UpdateTaskBodySchema = z.object({
	completed: z.boolean().optional(),
	dueDate: DueDateSchema.nullable().optional(),
	dueTime: DueTimeSchema.nullable().optional(),
	reminderOffsetMinutes: ReminderOffsetMinutesSchema.nullable().optional(),
	title: TaskTitleInputSchema.optional(),
	assigneeId: z.string().nullable().optional(),
});

export const UpdateTaskInputSchema =
	TaskIdInputSchema.merge(UpdateTaskBodySchema);

export const DeleteTaskOutputSchema = z.void();

export const TaskNotificationActionBodySchema = z.discriminatedUnion("action", [
	z.object({ action: z.literal("complete") }),
	z.object({
		action: z.literal("snooze"),
		preset: z.enum(["15m", "1h", "tomorrow_9am"]),
	}),
]);

export const TaskNotificationActionInputSchema = z.discriminatedUnion(
	"action",
	[
		z.object({ id: z.string().uuid(), action: z.literal("complete") }),
		z.object({
			id: z.string().uuid(),
			action: z.literal("snooze"),
			preset: z.enum(["15m", "1h", "tomorrow_9am"]),
		}),
	],
);

export const TaskNotificationActionOutputSchema = z.object({
	action: z.enum(["complete", "snooze"]),
	notificationId: z.string().uuid(),
	taskId: z.string().uuid(),
	workspaceId: z.string(),
	pageId: z.string().uuid().nullable(),
	snoozedUntil: z.string().datetime().nullable(),
	unreadCount: z.number().int().min(0),
});

export type Task = z.infer<typeof TaskSchema>;
export type TaskWithPage = z.infer<typeof TaskWithPageSchema>;
export type ListTasksOutput = z.infer<typeof ListTasksOutputSchema>;
export type TaskFilter = z.infer<typeof TaskFilterSchema>;
export type TaskScope = z.infer<typeof TaskScopeSchema>;
export type CreateTaskInput = z.infer<typeof CreateTaskInputSchema>;
export type UpdateTaskInput = z.infer<typeof UpdateTaskInputSchema>;
