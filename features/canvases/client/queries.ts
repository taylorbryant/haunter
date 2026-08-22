import type { QueryClient } from "@tanstack/react-query";
import { rq } from "@/client";
import {
	createCanvas,
	deleteCanvas,
	getCanvas,
	getCanvasNavigation,
	listCanvases,
	recordCanvasView,
	saveCanvasSnapshot,
	setCanvasFavorite,
	updateCanvas,
} from "@/features/canvases/contracts";
import type {
	Canvas,
	CanvasListItem,
	CanvasNavigationOutput,
	CanvasSnapshot,
} from "@/features/canvases/schemas";

export function getCanvasQueryOptions(id: string) {
	return {
		...rq(getCanvas).queryOptions({ path: { id } }),
		// Liveblocks is only an acceleration layer. Polling keeps canvases fresh
		// when live updates are disabled or a client misses a broadcast.
		refetchInterval: 30_000,
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
		refetchInterval: 30_000,
	};
}

export function getCanvasNavigationQueryOptions(workspaceId: string) {
	return {
		...rq(getCanvasNavigation).queryOptions({ path: { workspaceId } }),
		refetchOnMount: false,
		refetchInterval: 30_000,
	};
}

export function setCanvasFavoriteMutationOptions() {
	return rq(setCanvasFavorite).mutationOptions();
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

export function saveCanvasSnapshotMutationOptions() {
	return rq(saveCanvasSnapshot).mutationOptions();
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

/** Fetch and cache the current server snapshot without reusing an older request. */
export async function refreshCanvasQuery(queryClient: QueryClient, id: string) {
	await cancelCanvasQuery(queryClient, id);
	return queryClient.fetchQuery({
		...getCanvasQueryOptions(id),
		staleTime: 0,
	});
}

/**
 * Mirror the current local snapshot into the cache so remounting the surface
 * (e.g. switching between the inline block and the expanded dialog) never
 * restores a stale drawing. Pass both server versions after persistence
 * succeeds so the next mount also uses the matching concurrency token.
 */
export async function setCanvasSnapshotInCache(
	queryClient: QueryClient,
	id: string,
	snapshot: CanvasSnapshot,
	versions?: Pick<Canvas, "updatedAt" | "snapshotUpdatedAt">,
) {
	await cancelCanvasQuery(queryClient, id);
	queryClient.setQueryData<Canvas>(canvasQueryKey(id), (current) =>
		current
			? {
					...current,
					snapshot,
					...versions,
				}
			: current,
	);
}
