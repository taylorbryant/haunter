"use client";

import { useSyncExternalStore } from "react";

const flushers = new Map<string, () => Promise<boolean>>();
const saveStates = new Map<string, CanvasSaveState>();
const saveStateListeners = new Map<string, Set<() => void>>();

export type CanvasSaveState = "saved" | "local" | "saving" | "error";

export function setCanvasSaveState(canvasId: string, next: CanvasSaveState) {
	if ((saveStates.get(canvasId) ?? "saved") === next) return;
	saveStates.set(canvasId, next);
	for (const listener of saveStateListeners.get(canvasId) ?? []) listener();
}

export function useCanvasSaveState(canvasId: string | null): CanvasSaveState {
	return useSyncExternalStore(
		(listener) => {
			if (!canvasId) return () => undefined;
			let listeners = saveStateListeners.get(canvasId);
			if (!listeners) {
				listeners = new Set();
				saveStateListeners.set(canvasId, listeners);
			}
			listeners.add(listener);
			return () => {
				listeners?.delete(listener);
				if (listeners?.size === 0) saveStateListeners.delete(canvasId);
			};
		},
		() => (canvasId ? (saveStates.get(canvasId) ?? "saved") : "saved"),
		() => "saved",
	);
}

export function registerCanvasSaveFlusher(
	canvasId: string,
	flush: () => Promise<boolean>,
) {
	flushers.set(canvasId, flush);
	return () => {
		if (flushers.get(canvasId) === flush) flushers.delete(canvasId);
	};
}

export async function flushPendingCanvasSave(
	canvasId: string,
): Promise<boolean> {
	const flush = flushers.get(canvasId);
	return flush ? flush() : true;
}
