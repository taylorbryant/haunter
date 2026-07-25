import type { TaskWithPage } from "@/features/tasks/schemas";

export const UPCOMING_TASK_SUMMARY_LIMIT = 5;

export type DueDateTaskGroup = {
	date: string;
	items: TaskWithPage[];
};

/** Tasks are already ordered by the repository, so grouping preserves row order. */
export function groupTasksByDueDate(tasks: TaskWithPage[]): DueDateTaskGroup[] {
	const groups = new Map<string, TaskWithPage[]>();

	for (const task of tasks) {
		if (!task.dueDate) continue;
		const items = groups.get(task.dueDate);
		if (items) {
			items.push(task);
		} else {
			groups.set(task.dueDate, [task]);
		}
	}

	return Array.from(groups, ([date, items]) => ({ date, items }));
}

function isoDateOrdinal(value: string): number {
	const [year, month, day] = value.split("-").map(Number);
	return Date.UTC(year, month - 1, day);
}

/** Timezone-agnostic heading relative to the supplied local date. */
export function formatUpcomingDateHeading(
	dueDate: string,
	todayDate: string,
): string {
	const days = Math.round(
		(isoDateOrdinal(dueDate) - isoDateOrdinal(todayDate)) / 86_400_000,
	);
	const [year, month, day] = dueDate.split("-").map(Number);
	const value = new Date(Date.UTC(year, month - 1, day, 12));

	if (days === 1) return "Tomorrow";
	if (days > 1 && days < 7) {
		return new Intl.DateTimeFormat("en-US", {
			timeZone: "UTC",
			weekday: "long",
		}).format(value);
	}
	return new Intl.DateTimeFormat("en-US", {
		timeZone: "UTC",
		weekday: "short",
		month: "short",
		day: "numeric",
	}).format(value);
}
