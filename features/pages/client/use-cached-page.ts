"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { Page } from "@/features/pages/schemas";
import { getPageQueryOptions } from "./queries";

/** Observe the page-query cache without issuing a request. */
export function useCachedPage(pageId: string | null) {
	const queryClient = useQueryClient();
	const queryKey = useMemo(
		() => (pageId ? getPageQueryOptions(pageId).queryKey : null),
		[pageId],
	);
	const subscribe = useCallback(
		(onStoreChange: () => void) =>
			queryClient.getQueryCache().subscribe(onStoreChange),
		[queryClient],
	);
	const getSnapshot = useCallback(
		() =>
			queryKey ? queryClient.getQueryData<Page>(queryKey) : undefined,
		[queryClient, queryKey],
	);
	const page = useSyncExternalStore(subscribe, getSnapshot, () => undefined);

	return pageId ? page : undefined;
}
