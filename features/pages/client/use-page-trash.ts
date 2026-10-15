"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { userErrorMessage } from "@/client/error-feedback";
import { invalidateTasks } from "@/features/tasks/client/queries";
import { buildPageTreeIndex } from "./page-tree-controller";
import {
	deletePageMutationOptions,
	invalidatePageNavigation,
	invalidatePages,
	invalidateTrash,
	listPagesQueryOptions,
} from "./queries";
import { flushPendingPageSave } from "./save-state";

class PageTrashSaveError extends Error {
	constructor() {
		super("Save your changes before moving this page to trash.");
	}
}

export function pageTrashErrorMessage(error: unknown) {
	return error instanceof PageTrashSaveError
		? error.message
		: userErrorMessage(error, "The page could not be moved to trash.");
}

/** Keep navigation attached to the removed subtree, even if the route changed. */
export function pageTrashDestination(
	pathname: string,
	workspaceId: string,
	pageIds: readonly string[],
) {
	const route = pathname.match(/^\/w\/([^/]+)\/p\/([^/]+)/);
	return route?.[1] === workspaceId && pageIds.includes(route[2])
		? `/w/${workspaceId}/home`
		: null;
}

export function usePageTrash() {
	const queryClient = useQueryClient();
	const mutation = useMutation({
		...deletePageMutationOptions(),
		meta: { errorMode: "inline" },
	});
	const inFlight = useRef(false);
	const [isPending, setPending] = useState(false);

	return {
		isPending,
		async moveToTrash({
			workspaceId,
			pageId,
			beforeRemove,
			onRemoved,
		}: {
			workspaceId: string;
			pageId: string;
			beforeRemove?: () => Promise<boolean>;
			onRemoved?: (pageIds: readonly string[]) => boolean;
		}) {
			if (inFlight.current) return;
			inFlight.current = true;
			setPending(true);
			try {
				const pages = await queryClient.ensureQueryData(
					listPagesQueryOptions(workspaceId),
				);
				const subtree = buildPageTreeIndex(pages.items).subtreeIdsById.get(
					pageId,
				);
				const pageIds = [...(subtree ?? [pageId])];
				// Embedded hosts also prepare canvases and host-owned draft state.
				try {
					if (beforeRemove && !(await beforeRemove()))
						throw new PageTrashSaveError();
					const saved = await Promise.all(pageIds.map(flushPendingPageSave));
					if (!saved.every(Boolean)) throw new PageTrashSaveError();
				} catch {
					throw new PageTrashSaveError();
				}
				await mutation.mutateAsync({ path: { id: pageId } });
				const handled = onRemoved?.(pageIds) ?? false;
				await Promise.all([
					invalidatePages(queryClient),
					invalidatePageNavigation(queryClient, workspaceId),
					invalidateTrash(queryClient),
					invalidateTasks(queryClient),
				]);
				return { pageIds, handled };
			} finally {
				inFlight.current = false;
				setPending(false);
			}
		},
	};
}
