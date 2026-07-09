import { describe, expect, it } from "bun:test";
import type { PageMeta } from "@/features/pages/schemas";
import { formatTodayDate, selectRecentPages } from "@/features/today/lib/today";

function page(title: string, updatedAt: string): PageMeta {
	return {
		id: crypto.randomUUID(),
		userId: "user_test",
		workspaceId: "workspace_test",
		parentPageId: null,
		title,
		icon: null,
		position: 0,
		deletedAt: null,
		createdAt: "2026-07-01T12:00:00.000Z",
		updatedAt,
	};
}

describe("Today helpers", () => {
	it("selects at most five pages by most recent workspace edit", () => {
		const pages = [
			page("Fourth", "2026-07-06T12:00:00.000Z"),
			page("Oldest", "2026-07-01T12:00:00.000Z"),
			page("Newest", "2026-07-09T12:00:00.000Z"),
			page("Third", "2026-07-07T12:00:00.000Z"),
			page("Fifth", "2026-07-05T12:00:00.000Z"),
			page("Second", "2026-07-08T12:00:00.000Z"),
		];

		expect(selectRecentPages(pages).map((item) => item.title)).toEqual([
			"Newest",
			"Second",
			"Third",
			"Fourth",
			"Fifth",
		]);
		expect(pages[0]?.title).toBe("Fourth");
	});

	it("formats the account-local date without applying the browser timezone", () => {
		expect(formatTodayDate("2026-07-09")).toBe("Thursday, July 9");
	});
});
