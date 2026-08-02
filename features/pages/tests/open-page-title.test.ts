import { describe, expect, it } from "bun:test";
import {
	optimisticallySetOpenPageTitle,
	registerOpenPageTitleWriter,
	restoreOpenPageTitle,
} from "@/features/pages/client/open-page-title";

describe("open page title mutations", () => {
	it("applies and conditionally rolls back a sidebar rename", () => {
		const pageId = "00000000-0000-4000-8000-000000000101";
		let title = "Original title";
		const unregister = registerOpenPageTitleWriter(pageId, {
			replace(nextTitle) {
				const previousTitle = title;
				title = nextTitle;
				return previousTitle;
			},
			replaceIfCurrent(expectedTitle, nextTitle) {
				if (title !== expectedTitle) return false;
				title = nextTitle;
				return true;
			},
		});

		const snapshot = optimisticallySetOpenPageTitle(pageId, "Sidebar title");
		expect(snapshot).toEqual({ previousTitle: "Original title" });
		expect(title).toBe("Sidebar title");

		expect(
			restoreOpenPageTitle(
				pageId,
				"Sidebar title",
				snapshot as NonNullable<typeof snapshot>,
			),
		).toBe(true);
		expect(title).toBe("Original title");
		unregister();
	});

	it("does not roll back over a newer collaborative title", () => {
		const pageId = "00000000-0000-4000-8000-000000000102";
		let title = "Original title";
		const unregister = registerOpenPageTitleWriter(pageId, {
			replace(nextTitle) {
				const previousTitle = title;
				title = nextTitle;
				return previousTitle;
			},
			replaceIfCurrent(expectedTitle, nextTitle) {
				if (title !== expectedTitle) return false;
				title = nextTitle;
				return true;
			},
		});

		const snapshot = optimisticallySetOpenPageTitle(pageId, "Sidebar title");
		title = "Collaborator title";

		expect(
			restoreOpenPageTitle(
				pageId,
				"Sidebar title",
				snapshot as NonNullable<typeof snapshot>,
			),
		).toBe(false);
		expect(title).toBe("Collaborator title");
		unregister();
	});
});
