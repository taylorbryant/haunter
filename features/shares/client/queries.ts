import type { QueryClient } from "@tanstack/react-query";
import { rq } from "@/client";
import {
	createPageShare,
	getPageShare,
	revokePageShare,
} from "@/features/shares/contracts";

export function getPageShareQueryOptions(pageId: string) {
	return rq(getPageShare).queryOptions({ path: { pageId } });
}

export function createPageShareMutationOptions() {
	return rq(createPageShare).mutationOptions();
}

export function revokePageShareMutationOptions() {
	return rq(revokePageShare).mutationOptions();
}

export function invalidatePageShare(queryClient: QueryClient, pageId: string) {
	return rq(getPageShare).invalidate(queryClient, { path: { pageId } });
}
