import { cursorPagination } from "@beignet/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { keepPreviousData } from "@tanstack/react-query";
import { rq } from "@/client";
import {
	captureInboxItem,
	listInboxItems,
	resolveInboxItem,
} from "@/features/inbox/contracts";

const INBOX_PAGE_SIZE = 20;

export function listInboxItemsInfiniteQueryOptions(workspaceId: string) {
	return {
		...rq(listInboxItems).infiniteQueryOptions({
			path: { workspaceId },
			query: { limit: INBOX_PAGE_SIZE },
			...cursorPagination(),
			placeholderData: keepPreviousData,
		}),
		refetchInterval: 30_000,
	};
}

export function captureInboxItemMutationOptions() {
	return rq(captureInboxItem).mutationOptions();
}

export function resolveInboxItemMutationOptions() {
	return rq(resolveInboxItem).mutationOptions();
}

export function invalidateInboxItems(queryClient: QueryClient) {
	return rq(listInboxItems).invalidate(queryClient);
}
