import { describe, expect, it } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import {
	getCanvasNavigationQueryOptions,
	listCanvasesQueryOptions,
	setFavoriteInCanvasNavigationCache,
	setViewedInCanvasNavigationCache,
} from "@/features/canvases/client/queries";
import type {
	CanvasListItem,
	CanvasNavigationOutput,
} from "@/features/canvases/schemas";

function canvas(index: number): CanvasListItem {
	return {
		id: crypto.randomUUID(),
		userId: "user_test",
		workspaceId: "workspace_test",
		pageId: null,
		title: `Canvas ${index}`,
		createdAt: "2026-07-01T12:00:00.000Z",
		updatedAt: "2026-07-01T12:00:00.000Z",
	};
}

function setup() {
	const queryClient = new QueryClient();
	const queryKey = getCanvasNavigationQueryOptions("workspace_test").queryKey;
	queryClient.setQueryData<CanvasNavigationOutput>(queryKey, {
		favorites: [],
		recents: [],
	});
	return { queryClient, queryKey };
}

describe("canvas navigation cache", () => {
	it("does not remount-refetch hydrated canvas navigation", () => {
		const options = getCanvasNavigationQueryOptions("workspace_test");

		expect(options.refetchOnMount).toBe(false);
		expect(options.refetchInterval).toBe(30_000);
	});

	it("polls the standalone canvas list as a live-update fallback", () => {
		expect(listCanvasesQueryOptions("workspace_test").refetchInterval).toBe(
			30_000,
		);
	});

	it("adds and removes canvas favorites at the front", () => {
		const { queryClient, queryKey } = setup();
		const first = canvas(1);
		const second = canvas(2);

		setFavoriteInCanvasNavigationCache(
			queryClient,
			"workspace_test",
			first,
			"2026-07-24T12:00:00.000Z",
		);
		setFavoriteInCanvasNavigationCache(
			queryClient,
			"workspace_test",
			second,
			"2026-07-24T12:01:00.000Z",
		);
		expect(
			queryClient
				.getQueryData<CanvasNavigationOutput>(queryKey)
				?.favorites.map((item) => item.id),
		).toEqual([second.id, first.id]);

		setFavoriteInCanvasNavigationCache(
			queryClient,
			"workspace_test",
			second,
			null,
		);
		expect(
			queryClient
				.getQueryData<CanvasNavigationOutput>(queryKey)
				?.favorites.map((item) => item.id),
		).toEqual([first.id]);
	});

	it("moves revisited canvases to the front and caps recents at ten", () => {
		const { queryClient, queryKey } = setup();
		const canvases = Array.from({ length: 11 }, (_, index) => canvas(index));
		for (const [index, item] of canvases.entries()) {
			setViewedInCanvasNavigationCache(
				queryClient,
				"workspace_test",
				item,
				new Date(Date.UTC(2026, 6, 24, 12, index)).toISOString(),
			);
		}

		let recents =
			queryClient.getQueryData<CanvasNavigationOutput>(queryKey)?.recents ?? [];
		expect(recents).toHaveLength(10);
		expect(recents[0]?.id).toBe(canvases[10]?.id);

		setViewedInCanvasNavigationCache(
			queryClient,
			"workspace_test",
			canvases[5] as CanvasListItem,
			"2026-07-24T13:00:00.000Z",
		);
		recents =
			queryClient.getQueryData<CanvasNavigationOutput>(queryKey)?.recents ?? [];
		expect(recents[0]?.id).toBe(canvases[5]?.id);
		expect(new Set(recents.map((item) => item.id)).size).toBe(10);
	});
});
