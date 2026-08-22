import type { CanvasNavigationItem } from "@/features/canvases/schemas";
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

export type HomeNavigationItem = {
	kind: "canvas" | "page";
	id: string;
	title: string | null;
	icon: string | null;
	favoritedAt: string | null;
	lastViewedAt: string | null;
};

export function mergeHomeNavigationItems(
	pages: PageNavigationItem[],
	canvases: CanvasNavigationItem[],
	orderBy: "favoritedAt" | "lastViewedAt",
): HomeNavigationItem[] {
	return [
		...pages.map((page) => ({
			kind: "page" as const,
			id: page.id,
			title: page.title,
			icon: page.icon,
			favoritedAt: page.favoritedAt,
			lastViewedAt: page.lastViewedAt,
		})),
		...canvases.map((canvas) => ({
			kind: "canvas" as const,
			id: canvas.id,
			title: canvas.title,
			icon: null,
			favoritedAt: canvas.favoritedAt,
			lastViewedAt: canvas.lastViewedAt,
		})),
	].sort((left, right) =>
		(right[orderBy] ?? "").localeCompare(left[orderBy] ?? ""),
	);
}

export function distinctRecentItems(
	favorites: HomeNavigationItem[],
	recents: HomeNavigationItem[],
	limit = HOME_PAGE_LIST_LIMIT,
): HomeNavigationItem[] {
	const favoriteIds = new Set(
		favorites.map((item) => `${item.kind}:${item.id}`),
	);
	return recents
		.filter((item) => !favoriteIds.has(`${item.kind}:${item.id}`))
		.slice(0, limit);
}
