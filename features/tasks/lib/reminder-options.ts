import {
	type ReminderOffsetMinutes,
	TASK_REMINDER_OFFSETS,
} from "@/features/tasks/scheduling";

export type TaskReminderOffsetMinutes = ReminderOffsetMinutes | null;

const reminderLabels = {
	0: "At due time",
	15: "15 minutes before",
	60: "1 hour before",
	1440: "1 day before",
} satisfies Record<ReminderOffsetMinutes, string>;

export const TASK_REMINDER_OPTIONS = [
	{ label: "No reminder", value: "none" },
	...TASK_REMINDER_OFFSETS.map((offset) => ({
		label: reminderLabels[offset],
		value: String(offset),
	})),
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
	return offsetMinutes === 0 && dueTime === null
		? "Morning of, 9:00 AM"
		: option.label;
}

export function parseTaskReminderOffset(
	value: string,
): TaskReminderOffsetMinutes {
	return (
		TASK_REMINDER_OFFSETS.find((offset) => String(offset) === value) ?? null
	);
}
