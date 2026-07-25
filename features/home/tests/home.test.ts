import { describe, expect, it } from "bun:test";
import type { PageNavigationItem } from "@/features/pages/schemas";
import {
	addIsoDateDays,
	distinctRecentPages,
	formatHomeDate,
	getHomeUpcomingRange,
} from "../lib/home";

function page(id: string): PageNavigationItem {
	return {
		id,
		userId: "user-1",
		workspaceId: "workspace-1",
		parentPageId: null,
		title: id,
		icon: null,
		position: 0,
		deletedAt: null,
		createdAt: "2026-07-01T00:00:00.000Z",
		updatedAt: "2026-07-01T00:00:00.000Z",
		favoritedAt: null,
		lastViewedAt: "2026-07-01T00:00:00.000Z",
	};
}

describe("Home helpers", () => {
	it("formats a supplied local date without applying another timezone", () => {
		expect(formatHomeDate("2026-07-09")).toBe("Thursday, July 9");
	});

	it("builds a seven-day future range across month and year boundaries", () => {
		expect(getHomeUpcomingRange("2026-12-29")).toEqual({
			start: "2026-12-30",
			end: "2027-01-05",
		});
		expect(addIsoDateDays("2026-02-27", 2)).toBe("2026-03-01");
	});

	it("removes favorites from recents before applying the limit", () => {
		const favorites = [page("favorite")];
		const recents = [
			page("favorite"),
			page("recent-1"),
			page("recent-2"),
			page("recent-3"),
		];

		expect(
			distinctRecentPages(favorites, recents, 2).map(({ id }) => id),
		).toEqual(["recent-1", "recent-2"]);
	});
});
