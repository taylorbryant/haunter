"use client";

import type { CanvasSnapshot } from "@/features/canvases/schemas";

const flushers = new Map<string, () => Promise<boolean>>();
const pendingSaves = new Map<string, PendingCanvasSave>();

export type PendingCanvasSave = {
	snapshot: CanvasSnapshot;
	baseUpdatedAt: string;
	requiresConfirmation: true;
};

export function canvasPendingSaveKey(
	canvasId: string,
	currentUserId: string | null,
) {
	return JSON.stringify([currentUserId ?? "anonymous", canvasId]);
}

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
 * Keep a conflict-protected local snapshot outside the React surface so an
 * inline/fullscreen or route remount cannot silently reclassify it as saved.
 */
export function rememberPendingCanvasSave(
	key: string,
	input: Omit<PendingCanvasSave, "requiresConfirmation">,
): PendingCanvasSave {
	const pending = { ...input, requiresConfirmation: true } as const;
	pendingSaves.set(key, pending);
	return pending;
}

export function getPendingCanvasSave(key: string) {
	return pendingSaves.get(key) ?? null;
}

/** A stale surface must not clear a newer pending snapshot for the same id. */
export function clearPendingCanvasSave(
	key: string,
	expected: PendingCanvasSave,
) {
	if (pendingSaves.get(key) === expected) {
		pendingSaves.delete(key);
	}
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
