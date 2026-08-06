import type { QueryClient } from "@tanstack/react-query";
import {
	invalidateCanvas,
	invalidateCanvases,
} from "@/features/canvases/client/queries";
import { invalidateNotifications } from "@/features/notifications/client/queries";
import {
	invalidateBacklinks,
	invalidatePage,
	invalidatePageDetails,
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
		if (queryClient.isMutating() === 0) {
			unsubscribe();
			resolve();
		}
	});
}

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

export async function invalidateWorkspacePageProjections(
	queryClient: QueryClient,
	workspaceId: string,
	pageIds: readonly string[] = [],
) {
	await waitForMutationsToSettle(queryClient);
	const affectedPageIds = [...new Set(pageIds)];
	await Promise.all([
		invalidatePages(queryClient),
		invalidatePageNavigation(queryClient, workspaceId),
		invalidateTrash(queryClient),
		invalidateBacklinks(queryClient),
		invalidatePageSearch(queryClient),
		invalidateTasksWhenIdle(queryClient),
		invalidateNotifications(queryClient),
		...(affectedPageIds.length === 0
			? [invalidatePageDetails(queryClient)]
			: []),
		...affectedPageIds.map((pageId) => invalidatePage(queryClient, pageId)),
	]);
}

export async function invalidateWorkspaceTaskProjections(
	queryClient: QueryClient,
) {
	await waitForMutationsToSettle(queryClient);
	await Promise.all([
		invalidateTasksWhenIdle(queryClient),
		invalidateNotifications(queryClient),
	]);
}

export async function invalidateWorkspaceCanvasProjection(
	queryClient: QueryClient,
	canvasId?: string,
) {
	await waitForMutationsToSettle(queryClient);
	await (canvasId
		? invalidateCanvas(queryClient, canvasId)
		: invalidateCanvases(queryClient));
}
