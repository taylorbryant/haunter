import { describe, expect, it } from "bun:test";
import {
	createWorkspaceCanvasEvent,
	createWorkspacePageEvent,
	createWorkspaceTaskEvent,
	isWorkspaceCanvasEvent,
	isWorkspaceEvent,
	isWorkspacePageEvent,
	isWorkspaceTaskEvent,
	workspaceEventAffectedPageIds,
	workspaceEventRemovesPage,
} from "../workspace-events";

describe("workspace events", () => {
	it("creates versioned, workspace-scoped page invalidation hints", () => {
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

	it("deduplicates subtree pages and identifies removed routes", () => {
		const event = createWorkspacePageEvent({
			type: "page.trashed",
			workspaceId: "workspace_1",
			pageId: "root",
			affectedPageIds: ["child", "root", "child"],
		});

		expect(workspaceEventAffectedPageIds(event)).toEqual(["root", "child"]);
		expect(workspaceEventRemovesPage(event, "child")).toBe(true);
		expect(workspaceEventRemovesPage(event, "other")).toBe(false);
	});

	it("creates task and canvas invalidation hints", () => {
		const task = createWorkspaceTaskEvent({
			workspaceId: "workspace_1",
			taskId: "task_1",
		});
		const canvas = createWorkspaceCanvasEvent({
			workspaceId: "workspace_1",
			canvasId: "canvas_1",
			pageId: "page_1",
		});

		expect(isWorkspaceTaskEvent(task)).toBe(true);
		expect(isWorkspaceCanvasEvent(canvas)).toBe(true);
		expect(
			isWorkspaceCanvasEvent(
				createWorkspaceCanvasEvent({
					workspaceId: "workspace_1",
					canvasId: "canvas_standalone",
					pageId: null,
				}),
			),
		).toBe(true);
		expect(isWorkspaceEvent(task)).toBe(true);
		expect(isWorkspaceEvent(canvas)).toBe(true);
	});

	it("rejects malformed and future-version payloads", () => {
		expect(isWorkspaceEvent(null)).toBe(false);
		expect(
			isWorkspaceEvent({
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
				type: "page.trashed",
				workspaceId: "workspace_1",
				pageId: "page_1",
				affectedPageIds: ["page_1", 42],
				occurredAt: "2026-08-02T12:00:00.000Z",
			}),
		).toBe(false);
	});
});
