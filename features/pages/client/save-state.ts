"use client";

import { useSyncExternalStore } from "react";

export type PageSaveState = "saved" | "pending" | "saving" | "error";

/**
 * Tiny external store so the header can show the editor's save state
 * without threading props through the layout boundary.
 */
let state: PageSaveState = "saved";
const listeners = new Set<() => void>();
const flushers = new Map<string, () => Promise<boolean>>();

type DrainPageSaveQueueOptions = {
	clearPendingTimer: () => void;
	hasPendingChanges: () => boolean;
	save: () => Promise<boolean>;
};

export function setPageSaveState(next: PageSaveState) {
	if (state === next) return;
	state = next;
	for (const listener of listeners) {
		listener();
	}
}

export function usePageSaveState(): PageSaveState {
	return useSyncExternalStore(
		(listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		() => state,
		() => "saved" as const,
	);
}

export function registerPageSaveFlusher(
	pageId: string,
	flush: () => Promise<boolean>,
) {
	flushers.set(pageId, flush);
	return () => {
		if (flushers.get(pageId) === flush) {
			flushers.delete(pageId);
		}
	};
}

export async function flushPendingPageSave(pageId: string): Promise<boolean> {
	const flush = flushers.get(pageId);
	return flush ? flush() : true;
}

export async function drainPageSaveQueue({
	clearPendingTimer,
	hasPendingChanges,
	save,
}: DrainPageSaveQueueOptions): Promise<boolean> {
	while (true) {
		clearPendingTimer();
		const saved = await save();
		if (!saved) return false;
		if (!hasPendingChanges()) return true;
	}
}
