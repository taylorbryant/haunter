import { describe, expect, it } from "bun:test";
import { pageMaterializationEventType } from "@/features/documents/materialization-event";
import type { MaterializeResult } from "@/features/documents/service";

function projected(
	overrides: Partial<
		Extract<MaterializeResult, { status: "projected"; kind: "page" }>
	> = {},
): Extract<MaterializeResult, { status: "projected"; kind: "page" }> {
	return {
		status: "projected",
		kind: "page",
		updatedAt: "2026-08-02T12:00:00.000Z",
		contentUpdatedAt: "2026-08-02T12:00:00.000Z",
		titleChanged: false,
		contentChanged: false,
		tasksChanged: false,
		linksChanged: false,
		assignmentNotifications: [],
		...overrides,
	};
}

describe("document materialization workspace events", () => {
	it("broadcasts task-only projections as page content changes", () => {
		expect(
			pageMaterializationEventType(projected({ tasksChanged: true })),
		).toBe("page.contentChanged");
	});

	it("broadcasts ordinary body edits even without derived changes", () => {
		expect(
			pageMaterializationEventType(projected({ contentChanged: true })),
		).toBe("page.contentChanged");
	});

	it("uses one rename event for a combined title and content projection", () => {
		expect(
			pageMaterializationEventType(
				projected({ titleChanged: true, contentChanged: true }),
			),
		).toBe("page.renamed");
	});

	it("skips projections that changed no SQLite-backed data", () => {
		expect(pageMaterializationEventType(projected())).toBeNull();
	});
});
