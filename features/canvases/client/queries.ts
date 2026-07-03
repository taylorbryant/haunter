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

/**
 * Mirror a just-saved snapshot into the cache so remounting the surface
 * (e.g. switching between the inline block and the expanded dialog) never
 * restores a stale drawing.
 */
export function setCanvasSnapshotInCache(
	queryClient: QueryClient,
	id: string,
	snapshot: CanvasSnapshot,
) {
	queryClient.setQueryData<Canvas>(
		rq(getCanvas).key({ path: { id } }),
		(current) => (current ? { ...current, snapshot } : current),
	);
}
