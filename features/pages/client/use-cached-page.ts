"use client";

import { notifyManager, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { PageMeta } from "@/features/pages/schemas";
import { getEditorPageQueryOptions } from "./queries";

/** Observe the page-query cache without issuing a request. */
export function useCachedPage(pageId: string | null) {
	const queryClient = useQueryClient();
	const queryKey = useMemo(
		() => (pageId ? getEditorPageQueryOptions(pageId).queryKey : null),
		[pageId],
	);
	const subscribe = useCallback(
		(onStoreChange: () => void) =>
			queryClient
				.getQueryCache()
				.subscribe(notifyManager.batchCalls(onStoreChange)),
		[queryClient],
	);
	const getSnapshot = useCallback(
		() => (queryKey ? queryClient.getQueryData<PageMeta>(queryKey) : undefined),
		[queryClient, queryKey],
	);
	const page = useSyncExternalStore(subscribe, getSnapshot, () => undefined);

	return pageId ? page : undefined;
}
