import type { QueryClient } from "@tanstack/react-query";
import { rq } from "@/client";
import { approveWaitlistUser, listWaitlist } from "@/features/admin/contracts";

export function listWaitlistQueryOptions() {
	return rq(listWaitlist).queryOptions({});
}

export function approveWaitlistUserMutationOptions() {
	return rq(approveWaitlistUser).mutationOptions();
}

export function invalidateWaitlist(queryClient: QueryClient) {
	return rq(listWaitlist).invalidate(queryClient);
}
