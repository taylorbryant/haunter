"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
	getCanvasNavigationQueryOptions,
	setCanvasFavoriteMutationOptions,
	setFavoriteInCanvasNavigationCache,
} from "@/features/canvases/client/queries";
import type {
	CanvasListItem,
	CanvasNavigationOutput,
} from "@/features/canvases/schemas";

export function useCanvasFavorite(
	workspaceId: string,
	canvas: CanvasListItem | undefined,
) {
	const queryClient = useQueryClient();
	const queryKey = getCanvasNavigationQueryOptions(workspaceId).queryKey;
	const mutation = useMutation({
		...setCanvasFavoriteMutationOptions(),
		meta: { errorFallback: "The favorite could not be updated." },
		onMutate: async (variables) => {
			await queryClient.cancelQueries({ queryKey, exact: true });
			const previous =
				queryClient.getQueryData<CanvasNavigationOutput>(queryKey);
			if (canvas) {
				setFavoriteInCanvasNavigationCache(
					queryClient,
					workspaceId,
					canvas,
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
			if (canvas) {
				setFavoriteInCanvasNavigationCache(
					queryClient,
					workspaceId,
					canvas,
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
			if (!canvas || mutation.isPending) return;
			mutation.mutate({
				path: { id: canvas.id },
				body: { favorite },
			});
		},
	};
}
