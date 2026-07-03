import type { QueryClient } from "@tanstack/react-query";
import { rq } from "@/client";
import type { BlockJson, Page } from "@/features/pages/schemas";
import {
	createPage,
	deletePage,
	getPage,
	listBacklinks,
	listPages,
	listTrash,
	purgePage,
	restorePage,
	savePageContent,
	searchPages,
	updatePage,
} from "@/features/pages/contracts";

export function listPagesQueryOptions(workspaceId: string) {
	return rq(listPages).queryOptions({ path: { workspaceId } });
}

export function getPageQueryOptions(id: string) {
	return rq(getPage).queryOptions({ path: { id } });
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
