import { isAuthenticationError, sessionFetch } from "./session-recovery";
import { createClient } from "@beignet/core/client";
import { createReactQuery } from "@beignet/react-query";
import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import {
	type ErrorFeedbackMeta,
	reportUserError,
} from "@/client/error-feedback";

export const apiClient = createClient({
	validateInput: true,
	fetch: sessionFetch,
});

export const rq = createReactQuery(apiClient);

export function makeQueryClient() {
	return new QueryClient({
		queryCache: new QueryCache({
			onError: (error, query) => {
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
					!isAuthenticationError(error) &&
					failureCount < (typeof window === "undefined" ? 0 : 3),
			},
		},
	});
}
