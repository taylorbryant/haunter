import { describe, expect, it } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import {
	getPageNavigationQueryOptions,
	setFavoriteInNavigationCache,
	setViewedInNavigationCache,
	syncRecordedPageViewInNavigationCache,
} from "@/features/pages/client/queries";
import type { PageMeta, PageNavigationOutput } from "@/features/pages/schemas";

function page(index: number): PageMeta {
	return {
		id: crypto.randomUUID(),
		userId: "user_test",
		workspaceId: "workspace_test",
		parentPageId: null,
		title: `Page ${index}`,
		icon: null,
		position: index,
		deletedAt: null,
		createdAt: "2026-07-01T12:00:00.000Z",
		updatedAt: "2026-07-01T12:00:00.000Z",
	};
}

function setup() {
	const queryClient = new QueryClient();
	const queryKey = getPageNavigationQueryOptions("workspace_test").queryKey;
	queryClient.setQueryData<PageNavigationOutput>(queryKey, {
		favorites: [],
		recents: [],
	});
	return { queryClient, queryKey };
}

describe("page navigation cache", () => {
	it("adds and removes favorites at the front", () => {
		const { queryClient, queryKey } = setup();
		const first = page(1);
		const second = page(2);

		setFavoriteInNavigationCache(
			queryClient,
			"workspace_test",
			first,
			"2026-07-24T12:00:00.000Z",
		);
		setFavoriteInNavigationCache(
			queryClient,
			"workspace_test",
			second,
			"2026-07-24T12:01:00.000Z",
		);
		expect(
			queryClient
				.getQueryData<PageNavigationOutput>(queryKey)
				?.favorites.map((item) => item.id),
		).toEqual([second.id, first.id]);

		setFavoriteInNavigationCache(queryClient, "workspace_test", second, null);
		expect(
			queryClient
				.getQueryData<PageNavigationOutput>(queryKey)
				?.favorites.map((item) => item.id),
		).toEqual([first.id]);
	});

	it("moves revisited pages to the front and caps recents at ten", () => {
		const { queryClient, queryKey } = setup();
		const pages = Array.from({ length: 11 }, (_, index) => page(index));
		for (const [index, item] of pages.entries()) {
			setViewedInNavigationCache(
				queryClient,
				"workspace_test",
				item,
				new Date(Date.UTC(2026, 6, 24, 12, index)).toISOString(),
			);
		}
		let recents =
			queryClient.getQueryData<PageNavigationOutput>(queryKey)?.recents ?? [];
		expect(recents).toHaveLength(10);
		expect(recents[0]?.id).toBe(pages[10]?.id);

		setViewedInNavigationCache(
			queryClient,
			"workspace_test",
			pages[5] as PageMeta,
			"2026-07-24T13:00:00.000Z",
		);
		recents =
			queryClient.getQueryData<PageNavigationOutput>(queryKey)?.recents ?? [];
		expect(recents[0]?.id).toBe(pages[5]?.id);
		expect(new Set(recents.map((item) => item.id)).size).toBe(10);
	});

	it("keeps a completed view newer than an in-flight navigation response", async () => {
		const { queryClient, queryKey } = setup();
		const previous = page(1);
		const viewed = page(2);
		setViewedInNavigationCache(
			queryClient,
			"workspace_test",
			previous,
			"2026-07-24T12:00:00.000Z",
		);

		let resolveStale: ((value: PageNavigationOutput) => void) | undefined;
		const staleRequest = queryClient.fetchQuery({
			queryKey,
			queryFn: () =>
				new Promise<PageNavigationOutput>((resolve) => {
					resolveStale = resolve;
				}),
		});
		await syncRecordedPageViewInNavigationCache(
			queryClient,
			"workspace_test",
			viewed,
			"2026-07-24T13:00:00.000Z",
		);
		resolveStale?.({
			favorites: [],
			recents: [
				{
					...previous,
					favoritedAt: null,
					lastViewedAt: "2026-07-24T12:00:00.000Z",
				},
			],
		});
		await staleRequest.catch(() => undefined);

		expect(
			queryClient.getQueryData<PageNavigationOutput>(queryKey)?.recents[0]?.id,
		).toBe(viewed.id);
		expect(queryClient.getQueryState(queryKey)?.isInvalidated).toBe(true);
	});
});
