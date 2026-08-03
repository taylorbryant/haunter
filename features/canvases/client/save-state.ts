"use client";

const flushers = new Map<string, () => Promise<boolean>>();

type DrainCanvasSaveQueueOptions = {
	clearPendingTimer: () => void;
	hasPendingChanges: () => boolean;
	save: () => Promise<boolean>;
};

/**
 * Register the currently mounted surface for a canvas. Consumers that replace
 * that surface (for example, the fullscreen dialog) can wait until its local
 * snapshot is safely persisted before mounting a new tldraw store.
 */
export function registerCanvasSaveFlusher(
	canvasId: string,
	flush: () => Promise<boolean>,
) {
	flushers.set(canvasId, flush);
	return () => {
		if (flushers.get(canvasId) === flush) {
			flushers.delete(canvasId);
		}
	};
}

export async function flushPendingCanvasSave(
	canvasId: string,
): Promise<boolean> {
	const flush = flushers.get(canvasId);
	return flush ? flush() : true;
}

/**
 * A save can finish while a newer edit is waiting. Keep draining until the
 * mounted tldraw store reports no unsaved revisions, or stop on an error so
 * the surface remains mounted with the user's local drawing intact.
 */
export async function drainCanvasSaveQueue({
	clearPendingTimer,
	hasPendingChanges,
	save,
}: DrainCanvasSaveQueueOptions): Promise<boolean> {
	while (true) {
		clearPendingTimer();
		const saved = await save();
		if (!saved) return false;
		if (!hasPendingChanges()) return true;
	}
}
