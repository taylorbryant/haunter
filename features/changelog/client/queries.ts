import type { QueryClient } from "@tanstack/react-query";
import { rq } from "@/client";
import {
	getChangelogStatus,
	markChangelogSeen,
} from "@/features/changelog/contracts";
import type { ChangelogStatus } from "@/features/changelog/schemas";

export function changelogStatusQueryOptions() {
	return rq(getChangelogStatus).queryOptions({});
}

export function markChangelogSeenMutationOptions() {
	return rq(markChangelogSeen).mutationOptions();
}

export function markChangelogSeenInCache(
	queryClient: QueryClient,
	lastSeenVersion: string,
) {
	queryClient.setQueryData<ChangelogStatus>(
		rq(getChangelogStatus).key({}),
		(current) =>
			current
				? { ...current, lastSeenVersion, hasUnread: false }
				: {
						latestVersion: lastSeenVersion,
						lastSeenVersion,
						hasUnread: false,
					},
	);
}
