import type { PageNavigationItem } from "@/features/pages/schemas";

export const HOME_UPCOMING_DAYS = 7;
export const HOME_PAGE_LIST_LIMIT = 5;

export function formatHomeDate(date: string): string {
	const [year, month, day] = date.split("-").map(Number);
	const value = new Date(Date.UTC(year, month - 1, day, 12));
	return new Intl.DateTimeFormat("en-US", {
		timeZone: "UTC",
		weekday: "long",
		month: "long",
		day: "numeric",
	}).format(value);
}

export function addIsoDateDays(date: string, days: number): string {
	const [year, month, day] = date.split("-").map(Number);
	const value = new Date(Date.UTC(year, month - 1, day + days, 12));
	return value.toISOString().slice(0, 10);
}

export function getHomeUpcomingRange(todayDate: string): {
	start: string;
	end: string;
} {
	return {
		start: addIsoDateDays(todayDate, 1),
		end: addIsoDateDays(todayDate, HOME_UPCOMING_DAYS),
	};
}

export function distinctRecentPages(
	favorites: PageNavigationItem[],
	recents: PageNavigationItem[],
	limit = HOME_PAGE_LIST_LIMIT,
): PageNavigationItem[] {
	const favoriteIds = new Set(favorites.map((page) => page.id));
	return recents.filter((page) => !favoriteIds.has(page.id)).slice(0, limit);
}
