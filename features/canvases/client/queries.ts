import type { QueryClient } from "@tanstack/react-query";
import { rq } from "@/client";
import {
	createCanvas,
	getCanvas,
	saveCanvasSnapshot,
} from "@/features/canvases/contracts";
import type { Canvas, CanvasSnapshot } from "@/features/canvases/schemas";

export function getCanvasQueryOptions(id: string) {
	return rq(getCanvas).queryOptions({ path: { id } });
}

export function createCanvasMutationOptions() {
	return rq(createCanvas).mutationOptions();
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
 * restores a stale drawing. Pass updatedAt after persistence succeeds so the
 * next mount also uses the matching optimistic-concurrency version.
 */
export async function setCanvasSnapshotInCache(
	queryClient: QueryClient,
	id: string,
	snapshot: CanvasSnapshot,
	updatedAt?: string,
) {
	await cancelCanvasQuery(queryClient, id);
	queryClient.setQueryData<Canvas>(canvasQueryKey(id), (current) =>
		current
			? {
					...current,
					snapshot,
					...(updatedAt ? { updatedAt } : {}),
				}
			: current,
	);
}
