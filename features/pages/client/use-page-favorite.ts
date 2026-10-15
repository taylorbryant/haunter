"use client";

import {
	type QueryClient,
	useMutation,
	useQueryClient,
} from "@tanstack/react-query";
import {
	getPageMetadataQueryOptions,
	getPageNavigationQueryOptions,
	listPagesQueryOptions,
	setFavoriteInNavigationCache,
	setPageFavoriteMutationOptions,
} from "@/features/pages/client/queries";
import type { PageMeta, PageNavigationOutput } from "@/features/pages/schemas";

export function optimisticPageFavoriteMutationOptions(
	queryClient: QueryClient,
	workspaceId: string,
) {
	const queryKey = getPageNavigationQueryOptions(workspaceId).queryKey;
	const getPage = (id: string) =>
		queryClient.getQueryData<PageMeta>(
			getPageMetadataQueryOptions(id).queryKey,
		) ??
		queryClient
			.getQueryData<{ items: PageMeta[] }>(
				listPagesQueryOptions(workspaceId).queryKey,
			)
			?.items.find((page) => page.id === id);
	return {
		...setPageFavoriteMutationOptions(workspaceId, {
			onSuccess: (result) => {
				const page = getPage(result.pageId);
				if (page) {
					setFavoriteInNavigationCache(
						queryClient,
						workspaceId,
						page,
						result.favoritedAt,
					);
				}
			},
		}),
		meta: { errorFallback: "The favorite could not be updated." },
		onMutate: async (variables: {
			path: { id: string };
			body: { favorite: boolean };
		}) => {
			await queryClient.cancelQueries({ queryKey, exact: true });
			const previous = queryClient.getQueryData<PageNavigationOutput>(queryKey);
			const page = getPage(variables.path.id);
			if (page) {
				setFavoriteInNavigationCache(
					queryClient,
					workspaceId,
					page,
					variables.body.favorite ? new Date().toISOString() : null,
				);
			}
			return { queryKey, previous };
		},
		onError: (
			_error: unknown,
			_variables: unknown,
			context:
				| {
						queryKey: typeof queryKey;
						previous: PageNavigationOutput | undefined;
				  }
				| undefined,
		) => {
			if (context?.previous) {
				queryClient.setQueryData(context.queryKey, context.previous);
			}
			void queryClient.invalidateQueries({
				queryKey: context?.queryKey ?? queryKey,
				exact: true,
			});
		},
	};
}

export function usePageFavorite(workspaceId: string) {
	const queryClient = useQueryClient();
	const mutation = useMutation(
		optimisticPageFavoriteMutationOptions(queryClient, workspaceId),
	);

	return {
		isPending: mutation.isPending,
		toggle(pageId: string, favorite: boolean) {
			if (mutation.isPending) return;
			mutation.mutate({
				path: { id: pageId },
				body: { favorite },
			});
		},
	};
}
