import { createClient } from "@beignet/core/client";
import { createReactQuery } from "@beignet/react-query";
import { QueryClient } from "@tanstack/react-query";

export const apiClient = createClient({
	validateInput: true,
});

export const rq = createReactQuery(apiClient);

export function makeQueryClient() {
	return new QueryClient({
		defaultOptions: {
			queries: {
				staleTime: 60 * 1000,
			},
		},
	});
}
