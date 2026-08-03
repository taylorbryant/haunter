import type { QueryClient } from "@tanstack/react-query";
import {
	invalidateBacklinks,
	invalidatePage,
	invalidatePageNavigation,
	invalidatePageSearch,
	invalidatePages,
	invalidateTrash,
	listPagesQueryOptions,
} from "@/features/pages/client/queries";
import type { PageMeta } from "@/features/pages/schemas";
import { invalidateTasksWhenIdle } from "@/features/tasks/client/queries";

async function waitForMutationsToSettle(queryClient: QueryClient) {
	if (queryClient.isMutating() === 0) return;
	await new Promise<void>((resolve) => {
		const unsubscribe = queryClient.getMutationCache().subscribe(() => {
			if (queryClient.isMutating() === 0) {
				unsubscribe();
				resolve();
			}
		});
		// Close the subscribe/check race if the last mutation settled between the
		// initial test and listener registration.
		if (queryClient.isMutating() === 0) {
			unsubscribe();
			resolve();
		}
	});
}

/** After a reconnect, the ephemeral destructive event may already be gone.
 * The refreshed workspace list is the durable signal that an open route no
 * longer belongs in the active tree. Undefined means the list could not be
 * loaded, so callers keep the page rather than redirecting on a network error. */
export function pageIsMissingFromWorkspaceProjection(
	queryClient: QueryClient,
	workspaceId: string,
	pageId: string,
): boolean {
	const pages = queryClient.getQueryData<{ items: PageMeta[] }>(
		listPagesQueryOptions(workspaceId).queryKey,
	);
	return pages !== undefined && !pages.items.some((page) => page.id === pageId);
}

/** Reconcile every SQLite-backed projection that can embed page metadata.
 * Events intentionally carry no replacement data: invalidation preserves the
 * database as source of truth and makes dropped/out-of-order events harmless. */
export async function invalidateWorkspacePageProjections(
	queryClient: QueryClient,
	workspaceId: string,
	pageIds: readonly string[] = [],
): Promise<void> {
	// A remote refetch must not replace a newer optimistic write in this tab.
	// Once local mutations settle, the server projection includes both changes.
	await waitForMutationsToSettle(queryClient);
	const affectedPageIds = [...new Set(pageIds)];
	await Promise.all([
		invalidatePages(queryClient),
		invalidatePageNavigation(queryClient, workspaceId),
		invalidateTrash(queryClient),
		invalidateBacklinks(queryClient),
		invalidatePageSearch(queryClient),
		invalidateTasksWhenIdle(queryClient),
		...affectedPageIds.map((pageId) => invalidatePage(queryClient, pageId)),
	]);
}
