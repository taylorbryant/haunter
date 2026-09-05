import { createClient } from "@beignet/core/client";
import { createReactQuery } from "@beignet/react-query";
import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import {
	type ErrorFeedbackMeta,
	reportUserError,
} from "@/client/error-feedback";
import {
	isSessionExpiredError,
	reportSessionExpired,
} from "@/client/session-expiration";

export const apiClient = createClient({
	validateInput: true,
});

export const rq = createReactQuery(apiClient);

export function makeQueryClient() {
	return new QueryClient({
		queryCache: new QueryCache({
			onError: (error, query) => {
				if (reportSessionExpired(error)) return;
				const meta = query.meta as ErrorFeedbackMeta | undefined;
				if (meta?.errorMode === "inline" || meta?.errorMode === "silent") {
					return;
				}
				// Initial failures render in the owning surface. If cached data exists,
				// keep it visible and disclose that its background refresh failed.
				if (query.state.data !== undefined) {
					reportUserError(error, "Some information could not be refreshed.");
				}
			},
		}),
		mutationCache: new MutationCache({
			onError: (error, _variables, _context, mutation) => {
				if (reportSessionExpired(error)) return;
				const meta = mutation.meta as ErrorFeedbackMeta | undefined;
				if (meta?.errorMode === "inline" || meta?.errorMode === "silent") {
					return;
				}
				reportUserError(error, meta?.errorFallback);
			},
		}),
		defaultOptions: {
			queries: {
				staleTime: 60 * 1000,
				retry: (failureCount, error) =>
					typeof window !== "undefined" &&
					!isSessionExpiredError(error) &&
					failureCount < 3,
			},
		},
	});
}
