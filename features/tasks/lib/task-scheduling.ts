import type { Task } from "@/features/tasks/schemas";

export type TaskSchedulingState = Pick<
	Task,
	"assigneeId" | "dueDate" | "dueTime" | "reminderOffsetMinutes"
>;

export function hasTaskSchedulingChanged(
	current: TaskSchedulingState,
	next: TaskSchedulingState,
) {
	return (
		current.dueDate !== next.dueDate ||
		current.dueTime !== next.dueTime ||
		current.reminderOffsetMinutes !== next.reminderOffsetMinutes ||
		current.assigneeId !== next.assigneeId
	);
}
