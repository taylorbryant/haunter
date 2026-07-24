"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
	getPageNavigationQueryOptions,
	setFavoriteInNavigationCache,
	setPageFavoriteMutationOptions,
} from "@/features/pages/client/queries";
import type { PageMeta, PageNavigationOutput } from "@/features/pages/schemas";

export function usePageFavorite(
	workspaceId: string,
	page: PageMeta | undefined,
) {
	const queryClient = useQueryClient();
	const queryKey = getPageNavigationQueryOptions(workspaceId).queryKey;
	const mutation = useMutation({
		...setPageFavoriteMutationOptions(),
		meta: { errorFallback: "The favorite could not be updated." },
		onMutate: async (variables) => {
			await queryClient.cancelQueries({ queryKey, exact: true });
			const previous = queryClient.getQueryData<PageNavigationOutput>(queryKey);
			if (page) {
				setFavoriteInNavigationCache(
					queryClient,
					workspaceId,
					page,
					variables.body.favorite ? new Date().toISOString() : null,
				);
			}
			return { previous };
		},
		onError: (_error, _variables, context) => {
			if (context?.previous) {
				queryClient.setQueryData(queryKey, context.previous);
			}
		},
		onSuccess: (result) => {
			if (page) {
				setFavoriteInNavigationCache(
					queryClient,
					workspaceId,
					page,
					result.favoritedAt,
				);
			}
		},
		onSettled: () => {
			void queryClient.invalidateQueries({ queryKey, exact: true });
		},
	});

	return {
		isPending: mutation.isPending,
		toggle(favorite: boolean) {
			if (!page || mutation.isPending) return;
			mutation.mutate({
				path: { id: page.id },
				body: { favorite },
			});
		},
	};
}
