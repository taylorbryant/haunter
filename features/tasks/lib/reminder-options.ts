import type { Task } from "@/features/tasks/schemas";

export type TaskReminderOffsetMinutes = Task["reminderOffsetMinutes"];

export const TASK_REMINDER_OPTIONS = [
	{ label: "No reminder", value: "none" },
	{ label: "At due time", dateOnlyLabel: "Morning of, 9:00 AM", value: "0" },
	{ label: "15 minutes before", value: "15" },
	{ label: "1 hour before", value: "60" },
	{ label: "1 day before", value: "1440" },
] as const;

export function formatTaskReminderLabel(
	offsetMinutes: TaskReminderOffsetMinutes,
	dueTime: string | null,
): string {
	if (offsetMinutes === null) return "No reminder";
	const option = TASK_REMINDER_OPTIONS.find(
		(candidate) => candidate.value === String(offsetMinutes),
	);
	if (!option) return "No reminder";
	return offsetMinutes === 0 && dueTime === null && "dateOnlyLabel" in option
		? option.dateOnlyLabel
		: option.label;
}

export function parseTaskReminderOffset(
	value: string,
): TaskReminderOffsetMinutes {
	switch (value) {
		case "0":
			return 0;
		case "15":
			return 15;
		case "60":
			return 60;
		case "1440":
			return 1_440;
		default:
			return null;
	}
}
