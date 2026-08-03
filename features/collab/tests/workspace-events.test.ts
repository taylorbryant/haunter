import { describe, expect, it } from "bun:test";
import {
	createWorkspacePageEvent,
	isWorkspacePageEvent,
	workspaceEventAffectedPageIds,
	workspaceEventRemovesPage,
} from "../workspace-events";

describe("workspace page events", () => {
	it("creates a versioned, workspace-scoped invalidation hint", () => {
		const event = createWorkspacePageEvent({
			type: "page.moved",
			workspaceId: "workspace_1",
			pageId: "page_1",
			occurredAt: "2026-08-02T12:00:00.000Z",
		});

		expect(event).toEqual({
			schemaVersion: 1,
			type: "page.moved",
			workspaceId: "workspace_1",
			pageId: "page_1",
			occurredAt: "2026-08-02T12:00:00.000Z",
		});
		expect(isWorkspacePageEvent(event)).toBe(true);
	});

	it("carries every page affected by a destructive subtree mutation", () => {
		const event = createWorkspacePageEvent({
			type: "page.trashed",
			workspaceId: "workspace_1",
			pageId: "root",
			affectedPageIds: ["child", "root", "child"],
		});

		expect(workspaceEventAffectedPageIds(event)).toEqual(["root", "child"]);
		expect(workspaceEventRemovesPage(event, "child")).toBe(true);
		expect(workspaceEventRemovesPage(event, "other")).toBe(false);
		expect(isWorkspacePageEvent(event)).toBe(true);
	});

	it("rejects malformed and future-version broadcast payloads", () => {
		expect(isWorkspacePageEvent(null)).toBe(false);
		expect(
			isWorkspacePageEvent({
				schemaVersion: 2,
				type: "page.moved",
				workspaceId: "workspace_1",
				pageId: "page_1",
				occurredAt: "2026-08-02T12:00:00.000Z",
			}),
		).toBe(false);
		expect(
			isWorkspacePageEvent({
				schemaVersion: 1,
				type: "page.destroyEverything",
				workspaceId: "workspace_1",
				pageId: "page_1",
				occurredAt: "2026-08-02T12:00:00.000Z",
			}),
		).toBe(false);
		expect(
			isWorkspacePageEvent({
				schemaVersion: 1,
				type: "page.trashed",
				workspaceId: "workspace_1",
				pageId: "page_1",
				affectedPageIds: ["page_1", 42],
				occurredAt: "2026-08-02T12:00:00.000Z",
			}),
		).toBe(false);
	});
});
