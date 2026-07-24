import type { QueryClient } from "@tanstack/react-query";
import { rq } from "@/client";
import {
	createPage,
	deletePage,
	getPage,
	getPageNavigation,
	getPageVersion,
	listBacklinks,
	listPages,
	listPageVersions,
	listTrash,
	purgePage,
	recordPageView,
	restorePage,
	restorePageVersion,
	savePageContent,
	searchPages,
	setPageFavorite,
	updatePage,
} from "@/features/pages/contracts";
import type {
	BlockJson,
	Page,
	PageMeta,
	PageNavigationOutput,
} from "@/features/pages/schemas";

export function listPagesQueryOptions(workspaceId: string) {
	return {
		...rq(listPages).queryOptions({ path: { workspaceId } }),
		// Shared workspaces: pick up other members' changes without a manual
		// reload. Paused automatically while the tab is in the background.
		refetchInterval: 30_000,
	};
}

export function getPageQueryOptions(id: string) {
	return rq(getPage).queryOptions({ path: { id } });
}

export function getPageNavigationQueryOptions(workspaceId: string) {
	return {
		...rq(getPageNavigation).queryOptions({ path: { workspaceId } }),
		refetchInterval: 30_000,
	};
}

export function setPageFavoriteMutationOptions() {
	return rq(setPageFavorite).mutationOptions();
}

export function recordPageViewMutationOptions() {
	return rq(recordPageView).mutationOptions();
}

export function invalidatePageNavigation(
	queryClient: QueryClient,
	workspaceId: string,
) {
	return rq(getPageNavigation).invalidate(queryClient, {
		path: { workspaceId },
	});
}

export function setFavoriteInNavigationCache(
	queryClient: QueryClient,
	workspaceId: string,
	page: PageMeta,
	favoritedAt: string | null,
) {
	queryClient.setQueryData<PageNavigationOutput>(
		rq(getPageNavigation).key({ path: { workspaceId } }),
		(current) => {
			if (!current) return current;
			const withoutPage = current.favorites.filter(
				(item) => item.id !== page.id,
			);
			return {
				...current,
				favorites: favoritedAt
					? [
							{
								...page,
								favoritedAt,
								lastViewedAt:
									current.recents.find((item) => item.id === page.id)
										?.lastViewedAt ?? null,
							},
							...withoutPage,
						]
					: withoutPage,
			};
		},
	);
}

export function setViewedInNavigationCache(
	queryClient: QueryClient,
	workspaceId: string,
	page: PageMeta,
	lastViewedAt: string,
) {
	queryClient.setQueryData<PageNavigationOutput>(
		rq(getPageNavigation).key({ path: { workspaceId } }),
		(current) => {
			if (!current) return current;
			const favorite = current.favorites.find((item) => item.id === page.id);
			const navigationPage = {
				...page,
				favoritedAt: favorite?.favoritedAt ?? null,
				lastViewedAt,
			};
			return {
				favorites: current.favorites.map((item) =>
					item.id === page.id ? { ...item, lastViewedAt } : item,
				),
				recents: [
					navigationPage,
					...current.recents.filter((item) => item.id !== page.id),
				].slice(0, 10),
			};
		},
	);
}

/**
 * Reconcile a completed view write with navigation data. A navigation request
 * may have started before the write and must not be allowed to overwrite the
 * newer ordering when it resolves. The final invalidation also covers the
 * case where navigation data had not been loaded yet, so the optimistic cache
 * update was intentionally a no-op.
 */
export async function syncRecordedPageViewInNavigationCache(
	queryClient: QueryClient,
	workspaceId: string,
	page: PageMeta,
	lastViewedAt: string,
) {
	const queryKey = rq(getPageNavigation).key({ path: { workspaceId } });
	await queryClient.cancelQueries(
		{ queryKey, exact: true },
		{ revert: false, silent: true },
	);
	setViewedInNavigationCache(queryClient, workspaceId, page, lastViewedAt);
	await invalidatePageNavigation(queryClient, workspaceId);
}

export function createPageMutationOptions() {
	return rq(createPage).mutationOptions();
}

export function updatePageMutationOptions() {
	return rq(updatePage).mutationOptions();
}

export function savePageContentMutationOptions() {
	return rq(savePageContent).mutationOptions();
}

export function deletePageMutationOptions() {
	return rq(deletePage).mutationOptions();
}

export function searchPagesQueryOptions(q: string) {
	return rq(searchPages).queryOptions({ query: { q } });
}

export function listBacklinksQueryOptions(id: string) {
	return rq(listBacklinks).queryOptions({ path: { id } });
}

/** Saves can change any page's incoming links, so invalidate them all. */
export function invalidateBacklinks(queryClient: QueryClient) {
	return rq(listBacklinks).invalidate(queryClient);
}

export function listTrashQueryOptions(workspaceId: string) {
	return rq(listTrash).queryOptions({ path: { workspaceId } });
}

export function restorePageMutationOptions() {
	return rq(restorePage).mutationOptions();
}

export function purgePageMutationOptions() {
	return rq(purgePage).mutationOptions();
}

export function invalidatePages(queryClient: QueryClient) {
	return rq(listPages).invalidate(queryClient);
}

export function invalidateTrash(queryClient: QueryClient) {
	return rq(listTrash).invalidate(queryClient);
}

export function invalidatePage(queryClient: QueryClient, id: string) {
	return rq(getPage).invalidate(queryClient, { path: { id } });
}

/**
 * Optimistically apply an icon change to every cache that renders it: the
 * page itself and each workspace's page list (which feeds the tree, mentions,
 * and backlinks). Writing synchronously means the change sticks even if the
 * picker unmounts before the mutation settles and drops its callback.
 */
export function setPageIconInCache(
	queryClient: QueryClient,
	id: string,
	icon: string | null,
) {
	queryClient.setQueryData<Page>(
		rq(getPage).key({ path: { id } }),
		(current) => (current ? { ...current, icon } : current),
	);
	queryClient.setQueriesData<{ items: PageMeta[] }>(
		rq(listPages).filter(),
		(current) =>
			current
				? {
						...current,
						items: current.items.map((page) =>
							page.id === id ? { ...page, icon } : page,
						),
					}
				: current,
	);
	queryClient.setQueriesData<PageNavigationOutput>(
		rq(getPageNavigation).filter(),
		(current) =>
			current
				? {
						favorites: current.favorites.map((page) =>
							page.id === id ? { ...page, icon } : page,
						),
						recents: current.recents.map((page) =>
							page.id === id ? { ...page, icon } : page,
						),
					}
				: current,
	);
}

/**
 * Reflect both timestamps from a content save into the getPage cache. The
 * display timestamp and the document CAS token intentionally advance together
 * here, while metadata-only writes preserve the document token.
 */
export function setPageSavedAtInCache(
	queryClient: QueryClient,
	id: string,
	updatedAt: string,
	contentUpdatedAt: string,
) {
	queryClient.setQueryData<Page>(
		rq(getPage).key({ path: { id } }),
		(current) =>
			current ? { ...current, updatedAt, contentUpdatedAt } : current,
	);
	queryClient.setQueriesData<PageNavigationOutput>(
		rq(getPageNavigation).filter(),
		(current) =>
			current
				? {
						favorites: current.favorites.map((page) =>
							page.id === id ? { ...page, updatedAt } : page,
						),
						recents: current.recents.map((page) =>
							page.id === id ? { ...page, updatedAt } : page,
						),
					}
				: current,
	);
}

/**
 * Fold a title save's response into the getPage cache. The title input hands
 * display back to the cached copy after a save, so without this the
 * just-typed title snaps back to the stale one (always visible with
 * collaboration off — there is no shared live title to paper over it).
 */
export function setPageTitleInCache(
	queryClient: QueryClient,
	id: string,
	title: string,
	updatedAt: string,
) {
	queryClient.setQueryData<Page>(
		rq(getPage).key({ path: { id } }),
		(current) => (current ? { ...current, title, updatedAt } : current),
	);
	queryClient.setQueriesData<PageNavigationOutput>(
		rq(getPageNavigation).filter(),
		(current) =>
			current
				? {
						favorites: current.favorites.map((page) =>
							page.id === id ? { ...page, title, updatedAt } : page,
						),
						recents: current.recents.map((page) =>
							page.id === id ? { ...page, title, updatedAt } : page,
						),
					}
				: current,
	);
}

/**
 * Mirror a just-saved document into the getPage cache so a remount between
 * the save and the next refetch never initializes the editor from stale data.
 */
export function setPageContentInCache(
	queryClient: QueryClient,
	id: string,
	content: BlockJson[],
) {
	queryClient.setQueryData<Page>(
		rq(getPage).key({ path: { id } }),
		(current) => (current ? { ...current, content } : current),
	);
}

export function listPageVersionsQueryOptions(pageId: string) {
	return rq(listPageVersions).queryOptions({ path: { id: pageId } });
}

export function getPageVersionQueryOptions(pageId: string, versionId: string) {
	return rq(getPageVersion).queryOptions({
		path: { id: pageId, versionId },
	});
}

export function restorePageVersionMutationOptions() {
	return rq(restorePageVersion).mutationOptions();
}

export function invalidatePageVersions(
	queryClient: QueryClient,
	pageId: string,
) {
	return rq(listPageVersions).invalidate(queryClient, {
		path: { id: pageId },
	});
}
