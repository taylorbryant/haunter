import { describe, expect, it } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import {
	getCanvasNavigationQueryOptions,
	getCanvasQueryOptions,
	listCanvasesQueryOptions,
} from "@/features/canvases/client/queries";
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
	reconcileWorkspaceEventConnection,
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

	it("invalidates every open page after connecting", async () => {
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

	it("reconciles all projections on the first confirmed connection", async () => {
		const queryClient = new QueryClient();
		const pageQuery = getPageQueryOptions("page_1");
		const otherPageQuery = getPageQueryOptions("page_2");
		const tasksQuery = listTasksQueryOptions("workspace_1", "open");
		const canvasQuery = getCanvasQueryOptions("canvas_1");
		queryClient.setQueryData(pageQuery.queryKey, { id: "page_1" });
		queryClient.setQueryData(otherPageQuery.queryKey, { id: "page_2" });
		queryClient.setQueryData(tasksQuery.queryKey, {
			items: [],
			hasMore: false,
		});
		queryClient.setQueryData(canvasQuery.queryKey, { id: "canvas_1" });
		queryClient.setQueryData(listPagesQueryOptions("workspace_1").queryKey, {
			items: [{ id: "page_1" }],
		});

		const result = await reconcileWorkspaceEventConnection(
			queryClient,
			"workspace_1",
			"page_1",
		);

		expect(result).toEqual({ currentPageMissing: false });
		expect(queryClient.getQueryState(pageQuery.queryKey)?.isInvalidated).toBe(
			true,
		);
		expect(
			queryClient.getQueryState(otherPageQuery.queryKey)?.isInvalidated,
		).toBe(true);
		expect(queryClient.getQueryState(tasksQuery.queryKey)?.isInvalidated).toBe(
			true,
		);
		expect(queryClient.getQueryState(canvasQuery.queryKey)?.isInvalidated).toBe(
			true,
		);
	});

	it("invalidates task, notification, and canvas projections", async () => {
		const queryClient = new QueryClient();
		const tasksQuery = listTasksQueryOptions("workspace_1", "open");
		const notificationsQuery = listNotificationsQueryOptions();
		const canvasQuery = getCanvasQueryOptions("canvas_1");
		const canvasListQuery = listCanvasesQueryOptions("workspace_1");
		const otherCanvasListQuery = listCanvasesQueryOptions("workspace_2");
		const canvasNavigationQuery =
			getCanvasNavigationQueryOptions("workspace_1");
		queryClient.setQueryData(tasksQuery.queryKey, {
			items: [],
			hasMore: false,
		});
		queryClient.setQueryData(notificationsQuery.queryKey, {
			items: [],
			unreadCount: 0,
			nextCursor: null,
		});
		queryClient.setQueryData(canvasQuery.queryKey, { id: "canvas_1" });
		queryClient.setQueryData(canvasListQuery.queryKey, { items: [] });
		queryClient.setQueryData(otherCanvasListQuery.queryKey, { items: [] });
		queryClient.setQueryData(canvasNavigationQuery.queryKey, {
			favorites: [],
			recents: [],
		});

		await invalidateWorkspaceTaskProjections(queryClient);
		await invalidateWorkspaceCanvasProjection(
			queryClient,
			"workspace_1",
			"canvas_1",
		);

		expect(queryClient.getQueryState(tasksQuery.queryKey)?.isInvalidated).toBe(
			true,
		);
		expect(
			queryClient.getQueryState(notificationsQuery.queryKey)?.isInvalidated,
		).toBe(true);
		expect(queryClient.getQueryState(canvasQuery.queryKey)?.isInvalidated).toBe(
			true,
		);
		expect(
			queryClient.getQueryState(canvasListQuery.queryKey)?.isInvalidated,
		).toBe(true);
		expect(
			queryClient.getQueryState(canvasNavigationQuery.queryKey)?.isInvalidated,
		).toBe(true);
		expect(
			queryClient.getQueryState(otherCanvasListQuery.queryKey)?.isInvalidated,
		).toBe(false);
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
