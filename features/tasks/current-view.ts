import { z } from "zod";
import {
	DueDateSchema,
	DueTimeSchema,
	ReminderOffsetMinutesSchema,
	TASK_TITLE_MAX_LENGTH,
} from "./schemas";

/** Small live UI snapshots; never an authorization grant or a full task export. */
export const SelectedTaskSchema = z
	.object({
		taskId: z.uuid().nullable(),
		pageId: z.uuid().nullable(),
		sourceBlockId: z.string().min(1).max(200).nullable(),
		title: z.string().max(TASK_TITLE_MAX_LENGTH),
		completed: z.boolean(),
		assigneeId: z.string().max(200).nullable(),
		dueDate: DueDateSchema.nullable(),
		dueTime: DueTimeSchema.nullable(),
		reminderOffsetMinutes: ReminderOffsetMinutesSchema.nullable(),
	})
	.refine((task) => !!task.taskId || !!(task.pageId && task.sourceBlockId));
export type SelectedTask = z.infer<typeof SelectedTaskSchema>;

export const TaskListViewSchema = z.object({
	view: z.enum(["tasks", "today", "upcoming"]),
	filter: z.enum(["open", "completed", "all"]),
	scope: z.enum(["mine", "everyone"]),
	taskId: z.uuid().optional(),
	dueOnOrAfter: DueDateSchema.optional(),
	dueOnOrBefore: DueDateSchema.optional(),
	visibleTaskIds: z.array(z.uuid()).max(200),
	hasMore: z.boolean(),
	status: z.enum(["loading", "ready", "unavailable"]),
});
export type TaskListView = z.infer<typeof TaskListViewSchema>;
export const TaskViewSchema = z.object({
	lists: z.array(TaskListViewSchema).max(2),
	selectedTask: SelectedTaskSchema.optional(),
	saveStatus: z.enum(["saved", "unsaved", "unknown"]),
});
export type TaskView = z.infer<typeof TaskViewSchema>;
