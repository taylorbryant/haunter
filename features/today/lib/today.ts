import type { PageMeta } from "@/features/pages/schemas";

export function selectRecentPages(pages: PageMeta[], limit = 5): PageMeta[] {
	return [...pages]
		.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
		.slice(0, limit);
}

export function formatTodayDate(date: string): string {
	const [year, month, day] = date.split("-").map(Number);
	const value = new Date(Date.UTC(year, month - 1, day, 12));
	return new Intl.DateTimeFormat("en-US", {
		timeZone: "UTC",
		weekday: "long",
		month: "long",
		day: "numeric",
	}).format(value);
}
