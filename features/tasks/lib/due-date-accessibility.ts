import type { TaskReminderOffsetMinutes } from "@/features/tasks/lib/reminder-options";
import { formatTaskReminderLabel } from "@/features/tasks/lib/reminder-options";
import { formatDueDateTimeLabel, parseIsoDate } from "@/lib/due-date";

export function formatDueDatePickerAccessibleName({
	action,
	dueDate,
	dueTime,
	reminderOffsetMinutes,
	today,
	loading = false,
	disabled = false,
}: {
	action: string;
	dueDate: string | null;
	dueTime: string | null;
	reminderOffsetMinutes: TaskReminderOffsetMinutes;
	today: string | null;
	loading?: boolean;
	disabled?: boolean;
}) {
	const details = loading
		? "loading"
		: dueDate && today
			? [
					formatDueDateTimeLabel(dueDate, dueTime, parseIsoDate(today)),
					reminderOffsetMinutes === null
						? null
						: formatTaskReminderLabel(reminderOffsetMinutes, dueTime),
				]
					.filter(Boolean)
					.join(", ")
			: "no due date";
	return [action, details, disabled ? "disabled" : null]
		.filter(Boolean)
		.join(", ");
}
