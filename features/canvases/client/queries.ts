import { protectedRefetchInterval } from "@/client/session-recovery";
import type { ContractUseMutationOptions } from "@beignet/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { rq } from "@/client";
import {
	createCanvas,
	deleteCanvas,
	getCanvas,
	getCanvasNavigation,
	listCanvases,
	recordCanvasView,
	setCanvasFavorite,
	updateCanvas,
} from "@/features/canvases/contracts";
import type {
	Canvas,
	CanvasListItem,
	CanvasNavigationOutput,
} from "@/features/canvases/schemas";

export function getCanvasQueryOptions(id: string) {
	return {
		...rq(getCanvas).queryOptions({ path: { id } }),
		// Refresh metadata and read-only projections; drawing edits arrive through Yjs.
		refetchInterval: protectedRefetchInterval,
	};
}

export function createCanvasMutationOptions() {
	return rq(createCanvas).mutationOptions();
}

export function listCanvasesQueryOptions(workspaceId: string) {
	return {
		...rq(listCanvases).queryOptions({ path: { workspaceId } }),
		// Workspace events accelerate this refresh, while polling covers disabled
		// live updates and broadcasts missed during a connection gap.
		refetchInterval: protectedRefetchInterval,
	};
}

export function getCanvasNavigationQueryOptions(workspaceId: string) {
	return {
		...rq(getCanvasNavigation).queryOptions({ path: { workspaceId } }),
		refetchOnMount: false,
		refetchInterval: protectedRefetchInterval,
	};
}

export function setCanvasFavoriteMutationOptions(
	workspaceId: string,
	options: Pick<
		ContractUseMutationOptions<typeof setCanvasFavorite.config>,
		"onSuccess"
	> = {},
) {
	return rq(setCanvasFavorite).mutationOptions({
		...options,
		mutationKey: [...rq(setCanvasFavorite).contractKey(), workspaceId],
		invalidates: () => [
			rq(getCanvasNavigation).filter({ path: { workspaceId } }),
		],
	});
}

export function recordCanvasViewMutationOptions() {
	return rq(recordCanvasView).mutationOptions();
}

export function invalidateCanvasNavigation(
	queryClient: QueryClient,
	workspaceId?: string,
) {
	return workspaceId
		? rq(getCanvasNavigation).invalidate(queryClient, {
				path: { workspaceId },
			})
		: rq(getCanvasNavigation).invalidate(queryClient);
}

export function setFavoriteInCanvasNavigationCache(
	queryClient: QueryClient,
	workspaceId: string,
	canvas: CanvasListItem,
	favoritedAt: string | null,
) {
	queryClient.setQueryData<CanvasNavigationOutput>(
		rq(getCanvasNavigation).key({ path: { workspaceId } }),
		(current) => {
			if (!current) return current;
			const withoutCanvas = current.favorites.filter(
				(item) => item.id !== canvas.id,
			);
			return {
				...current,
				favorites: favoritedAt
					? [
							{
								...canvas,
								favoritedAt,
								lastViewedAt:
									current.recents.find((item) => item.id === canvas.id)
										?.lastViewedAt ?? null,
							},
							...withoutCanvas,
						]
					: withoutCanvas,
			};
		},
	);
}

export function setViewedInCanvasNavigationCache(
	queryClient: QueryClient,
	workspaceId: string,
	canvas: CanvasListItem,
	lastViewedAt: string,
) {
	queryClient.setQueryData<CanvasNavigationOutput>(
		rq(getCanvasNavigation).key({ path: { workspaceId } }),
		(current) => {
			if (!current) return current;
			const favorite = current.favorites.find((item) => item.id === canvas.id);
			const navigationCanvas = {
				...canvas,
				favoritedAt: favorite?.favoritedAt ?? null,
				lastViewedAt,
			};
			return {
				favorites: current.favorites.map((item) =>
					item.id === canvas.id ? { ...item, lastViewedAt } : item,
				),
				recents: [
					navigationCanvas,
					...current.recents.filter((item) => item.id !== canvas.id),
				].slice(0, 10),
			};
		},
	);
}

export async function syncRecordedCanvasViewInNavigationCache(
	queryClient: QueryClient,
	workspaceId: string,
	canvas: CanvasListItem,
	lastViewedAt: string,
) {
	const queryKey = rq(getCanvasNavigation).key({ path: { workspaceId } });
	await queryClient.cancelQueries(
		{ queryKey, exact: true },
		{ revert: false, silent: true },
	);
	setViewedInCanvasNavigationCache(
		queryClient,
		workspaceId,
		canvas,
		lastViewedAt,
	);
	await invalidateCanvasNavigation(queryClient, workspaceId);
}

export function updateCanvasMutationOptions() {
	return rq(updateCanvas).mutationOptions();
}

export function deleteCanvasMutationOptions() {
	return rq(deleteCanvas).mutationOptions();
}

function canvasQueryKey(id: string) {
	return rq(getCanvas).key({ path: { id } });
}

/**
 * Stop an older canvas response from landing after a local snapshot has been
 * staged or persisted. React Query reverts a cancelled fetch before the caller
 * installs its authoritative cache value.
 */
export function cancelCanvasQuery(queryClient: QueryClient, id: string) {
	return queryClient.cancelQueries({
		queryKey: canvasQueryKey(id),
		exact: true,
	});
}

export function invalidateCanvas(queryClient: QueryClient, id: string) {
	return rq(getCanvas).invalidate(queryClient, { path: { id } });
}

export function invalidateCanvasList(
	queryClient: QueryClient,
	workspaceId?: string,
) {
	return workspaceId
		? rq(listCanvases).invalidate(queryClient, { path: { workspaceId } })
		: rq(listCanvases).invalidate(queryClient);
}

export function invalidateCanvases(queryClient: QueryClient) {
	return Promise.all([
		rq(getCanvas).invalidate(queryClient),
		rq(listCanvases).invalidate(queryClient),
		rq(getCanvasNavigation).invalidate(queryClient),
	]);
}

export function setCanvasTitleInCache(
	queryClient: QueryClient,
	id: string,
	title: string,
	updatedAt?: string,
) {
	queryClient.setQueryData<Canvas>(canvasQueryKey(id), (current) =>
		current
			? { ...current, title, ...(updatedAt ? { updatedAt } : {}) }
			: current,
	);
}
