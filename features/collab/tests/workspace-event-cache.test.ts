import { describe, expect, it } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { getCanvasQueryOptions } from "@/features/canvases/client/queries";
import { listNotificationsQueryOptions } from "@/features/notifications/client/queries";
import {
	getPageQueryOptions,
	listPagesQueryOptions,
} from "@/features/pages/client/queries";
import { listTasksQueryOptions } from "@/features/tasks/client/queries";
import {
	invalidateWorkspaceCanvasProjection,
	invalidateWorkspacePageProjections,
	invalidateWorkspaceTaskProjections,
	pageIsMissingFromWorkspaceProjection,
} from "../client/workspace-event-cache";

describe("workspace event cache reconciliation", () => {
	it("waits for optimistic mutations before invalidating projections", async () => {
		const queryClient = new QueryClient();
		let finishMutation: (() => void) | undefined;
		const mutation = queryClient.getMutationCache().build(queryClient, {
			mutationFn: () =>
				new Promise<void>((resolve) => {
					finishMutation = resolve;
				}),
		});
		const mutationPromise = mutation.execute(undefined);
		await Promise.resolve();

		let invalidated = false;
		const invalidation = invalidateWorkspacePageProjections(
			queryClient,
			"workspace_1",
			["page_1"],
		).then(() => {
			invalidated = true;
		});
		await Promise.resolve();
		expect(invalidated).toBe(false);

		finishMutation?.();
		await mutationPromise;
		await invalidation;
		expect(invalidated).toBe(true);
	});

	it("invalidates every affected page", async () => {
		const queryClient = new QueryClient();
		const rootQuery = getPageQueryOptions("root");
		const childQuery = getPageQueryOptions("child");
		queryClient.setQueryData(rootQuery.queryKey, { id: "root" });
		queryClient.setQueryData(childQuery.queryKey, { id: "child" });

		await invalidateWorkspacePageProjections(queryClient, "workspace_1", [
			"root",
			"child",
		]);

		expect(queryClient.getQueryState(rootQuery.queryKey)?.isInvalidated).toBe(
			true,
		);
		expect(queryClient.getQueryState(childQuery.queryKey)?.isInvalidated).toBe(
			true,
		);
	});

	it("invalidates every open page after reconnecting", async () => {
		const queryClient = new QueryClient();
		const firstQuery = getPageQueryOptions("first");
		const secondQuery = getPageQueryOptions("second");
		queryClient.setQueryData(firstQuery.queryKey, { id: "first" });
		queryClient.setQueryData(secondQuery.queryKey, { id: "second" });

		await invalidateWorkspacePageProjections(queryClient, "workspace_1");

		expect(queryClient.getQueryState(firstQuery.queryKey)?.isInvalidated).toBe(
			true,
		);
		expect(queryClient.getQueryState(secondQuery.queryKey)?.isInvalidated).toBe(
			true,
		);
	});

	it("invalidates task, notification, and canvas projections", async () => {
		const queryClient = new QueryClient();
		const tasksQuery = listTasksQueryOptions("workspace_1", "open");
		const notificationsQuery = listNotificationsQueryOptions();
		const canvasQuery = getCanvasQueryOptions("canvas_1");
		queryClient.setQueryData(tasksQuery.queryKey, { items: [], hasMore: false });
		queryClient.setQueryData(notificationsQuery.queryKey, {
			items: [],
			unreadCount: 0,
			nextCursor: null,
		});
		queryClient.setQueryData(canvasQuery.queryKey, { id: "canvas_1" });

		await invalidateWorkspaceTaskProjections(queryClient);
		await invalidateWorkspaceCanvasProjection(queryClient, "canvas_1");

		expect(queryClient.getQueryState(tasksQuery.queryKey)?.isInvalidated).toBe(
			true,
		);
		expect(
			queryClient.getQueryState(notificationsQuery.queryKey)?.isInvalidated,
		).toBe(true);
		expect(queryClient.getQueryState(canvasQuery.queryKey)?.isInvalidated).toBe(
			true,
		);
	});

	it("detects an open page removed while broadcasts were missed", () => {
		const queryClient = new QueryClient();
		queryClient.setQueryData(listPagesQueryOptions("workspace_1").queryKey, {
			items: [{ id: "remaining" }],
		});

		expect(
			pageIsMissingFromWorkspaceProjection(
				queryClient,
				"workspace_1",
				"deleted",
			),
		).toBe(true);
		expect(
			pageIsMissingFromWorkspaceProjection(
				queryClient,
				"workspace_1",
				"remaining",
			),
		).toBe(false);
	});
});
