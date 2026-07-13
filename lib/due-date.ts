/** Parse a stored `YYYY-MM-DD` string as a local date. */
export function parseIsoDate(value: string): Date | undefined {
	const [year, month, day] = value.split("-").map(Number);
	if (!year || !month || !day) return undefined;
	return new Date(year, month - 1, day);
}

export function toIsoDate(date: Date): string {
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${date.getFullYear()}-${month}-${day}`;
}

export function toIsoTime(date: Date): string {
	const hour = String(date.getHours()).padStart(2, "0");
	const minute = String(date.getMinutes()).padStart(2, "0");
	return `${hour}:${minute}`;
}

export function formatDueTimeLabel(value: string): string {
	const [hour, minute] = value.split(":").map(Number);
	if (
		!Number.isInteger(hour) ||
		!Number.isInteger(minute) ||
		hour < 0 ||
		hour > 23 ||
		minute < 0 ||
		minute > 59
	) {
		return value;
	}

	return new Date(2000, 0, 1, hour, minute).toLocaleTimeString(undefined, {
		hour: "numeric",
		minute: "2-digit",
	});
}

/** "Today", "Tomorrow", a weekday within a week, else "Jul 16". */
export function formatDueDateLabel(value: string, now = new Date()): string {
	const date = parseIsoDate(value);
	if (!date) return value;

	const today = new Date(now);
	today.setHours(0, 0, 0, 0);
	const days = Math.round((date.getTime() - today.getTime()) / 86_400_000);

	if (days === 0) return "Today";
	if (days === 1) return "Tomorrow";
	if (days > 1 && days < 7) {
		return date.toLocaleDateString(undefined, { weekday: "long" });
	}
	return date.toLocaleDateString(undefined, {
		month: "short",
		day: "numeric",
		...(date.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}),
	});
}

export function formatDueDateTimeLabel(
	dueDate: string,
	dueTime: string | null,
	now = new Date(),
): string {
	const date = formatDueDateLabel(dueDate, now);
	return dueTime ? `${date}, ${formatDueTimeLabel(dueTime)}` : date;
}

export function isDueOverdue(
	dueDate: string | null,
	dueTime: string | null,
	today = toIsoDate(new Date()),
	currentTime = toIsoTime(new Date()),
): boolean {
	if (dueDate === null) return false;
	if (dueDate < today) return true;
	if (dueDate > today || dueTime === null) return false;
	return dueTime <= currentTime;
}
