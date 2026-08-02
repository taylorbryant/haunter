import { describe, expect, it } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import {
	getPageNavigationQueryOptions,
	getPageQueryOptions,
	listPagesQueryOptions,
	optimisticallySetPagePlacement,
	optimisticallySetPageTitle,
	restorePagePlacementInCache,
	restorePageTitleInCache,
	setFavoriteInNavigationCache,
	setPageTitleInCache,
	setViewedInNavigationCache,
	syncRecordedPageViewInNavigationCache,
} from "@/features/pages/client/queries";
import type {
	Page,
	PageMeta,
	PageNavigationOutput,
} from "@/features/pages/schemas";

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

	it("updates titles in every page projection and conditionally rolls them back", () => {
		const { queryClient, queryKey: navigationKey } = setup();
		const item = page(1);
		const fullPage: Page = {
			...item,
			content: [],
			contentUpdatedAt: item.updatedAt,
		};
		const pageKey = getPageQueryOptions(item.id).queryKey;
		const listKey = listPagesQueryOptions("workspace_test").queryKey;
		queryClient.setQueryData(pageKey, fullPage);
		queryClient.setQueryData(listKey, { items: [item] });
		queryClient.setQueryData<PageNavigationOutput>(navigationKey, {
			favorites: [{ ...item, favoritedAt: item.updatedAt, lastViewedAt: null }],
			recents: [{ ...item, favoritedAt: null, lastViewedAt: item.updatedAt }],
		});

		setPageTitleInCache(
			queryClient,
			item.id,
			"Optimistic title",
			"2026-07-01T12:01:00.000Z",
		);
		expect(queryClient.getQueryData<Page>(pageKey)?.title).toBe(
			"Optimistic title",
		);
		expect(
			queryClient.getQueryData<{ items: PageMeta[] }>(listKey)?.items[0]?.title,
		).toBe("Optimistic title");
		expect(
			queryClient.getQueryData<PageNavigationOutput>(navigationKey)?.recents[0]
				?.title,
		).toBe("Optimistic title");

		restorePageTitleInCache(
			queryClient,
			item.id,
			"Optimistic title",
			item.title,
			item.updatedAt,
		);
		expect(queryClient.getQueryData<Page>(pageKey)).toEqual(fullPage);

		setPageTitleInCache(
			queryClient,
			item.id,
			"Newer title",
			"2026-07-01T12:02:00.000Z",
		);
		restorePageTitleInCache(
			queryClient,
			item.id,
			"Optimistic title",
			item.title,
			item.updatedAt,
		);
		expect(queryClient.getQueryData<Page>(pageKey)?.title).toBe("Newer title");
	});

	it("cancels stale title projections before applying an optimistic rename", async () => {
		const { queryClient, queryKey: navigationKey } = setup();
		const item = page(1);
		const savedTitle = "Saved editor title";
		const savedAt = "2026-07-01T12:03:00.000Z";
		const savedItem = { ...item, title: savedTitle, updatedAt: savedAt };
		const listKey = listPagesQueryOptions("workspace_test").queryKey;
		queryClient.setQueryData(listKey, { items: [savedItem] });
		queryClient.setQueryData<PageNavigationOutput>(navigationKey, {
			favorites: [],
			recents: [{ ...savedItem, favoritedAt: null, lastViewedAt: savedAt }],
		});

		let resolveStale: ((value: { items: PageMeta[] }) => void) | undefined;
		const staleRequest = queryClient.fetchQuery({
			queryKey: listKey,
			queryFn: () =>
				new Promise<{ items: PageMeta[] }>((resolve) => {
					resolveStale = resolve;
				}),
		});
		const snapshot = await optimisticallySetPageTitle(
			queryClient,
			"workspace_test",
			item.id,
			"Sidebar title",
			{
				previousTitle: item.title,
				previousUpdatedAt: item.updatedAt,
			},
		);
		resolveStale?.({ items: [item] });
		await staleRequest.catch(() => undefined);

		expect(snapshot).toEqual({
			previousTitle: savedTitle,
			previousUpdatedAt: savedAt,
		});
		expect(
			queryClient.getQueryData<{ items: PageMeta[] }>(listKey)?.items[0]?.title,
		).toBe("Sidebar title");
		expect(
			queryClient.getQueryData<PageNavigationOutput>(navigationKey)?.recents[0]
				?.title,
		).toBe("Sidebar title");
	});

	it("updates page placement immediately and preserves newer placement on rollback", async () => {
		const queryClient = new QueryClient();
		const item = page(1);
		const listKey = listPagesQueryOptions("workspace_test").queryKey;
		queryClient.setQueryData(listKey, { items: [item] });

		const snapshot = await optimisticallySetPagePlacement(
			queryClient,
			item.id,
			"55530f67-739d-439f-b5db-399962ed368a",
			2,
		);
		expect(
			queryClient.getQueryData<{ items: PageMeta[] }>(listKey)?.items[0],
		).toMatchObject({
			parentPageId: "55530f67-739d-439f-b5db-399962ed368a",
			position: 2,
		});

		queryClient.setQueryData<{ items: PageMeta[] }>(listKey, (current) => ({
			items: (current?.items ?? []).map((page) =>
				page.id === item.id
					? {
							...page,
							parentPageId: "2a6e7f75-c9c9-4dba-86bd-67a79bc6405e",
							position: 3,
						}
					: page,
			),
		}));
		restorePagePlacementInCache(queryClient, item.id, snapshot);
		expect(
			queryClient.getQueryData<{ items: PageMeta[] }>(listKey)?.items[0],
		).toMatchObject({
			parentPageId: "2a6e7f75-c9c9-4dba-86bd-67a79bc6405e",
			position: 3,
		});
	});
});
