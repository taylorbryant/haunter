import { z } from "zod";

export const DueDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, {
	message: "Due date must be YYYY-MM-DD",
});

export const DueTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, {
	message: "Due time must be HH:mm",
});

export const TASK_REMINDER_OFFSETS = [0, 15, 60, 1_440] as const;
export const ReminderOffsetMinutesSchema = z.literal(TASK_REMINDER_OFFSETS);
export type ReminderOffsetMinutes = z.infer<typeof ReminderOffsetMinutesSchema>;

export function isTaskReminderOffset(
	value: unknown,
): value is ReminderOffsetMinutes {
	return TASK_REMINDER_OFFSETS.some((offset) => offset === value);
}
