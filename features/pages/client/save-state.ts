"use client";

import { useSyncExternalStore } from "react";

export type PageSaveState = "saved" | "pending" | "saving" | "error";

/**
 * Tiny external store so the header can show the editor's save state
 * without threading props through the layout boundary.
 */
let state: PageSaveState = "saved";
const listeners = new Set<() => void>();

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
