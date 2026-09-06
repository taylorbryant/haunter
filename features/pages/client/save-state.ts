"use client";

import { useSyncExternalStore } from "react";

export type PageSaveState = "saved" | "pending" | "saving" | "error" | "paused";

let state: PageSaveState = "saved";
const listeners = new Set<() => void>();
const flushers = new Map<string, Map<symbol, () => Promise<boolean>>>();

export function setPageSaveState(next: PageSaveState) {
	if (state === next) return;
	state = next;
	for (const listener of listeners) listener();
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

/** Register one independently durable field belonging to a page. */
export function registerPageSaveFlusher(
	pageId: string,
	flush: () => Promise<boolean>,
) {
	const registration = Symbol(pageId);
	let pageFlushers = flushers.get(pageId);
	if (!pageFlushers) {
		pageFlushers = new Map();
		flushers.set(pageId, pageFlushers);
	}
	pageFlushers.set(registration, flush);
	return () => {
		const registered = flushers.get(pageId);
		registered?.delete(registration);
		if (registered?.size === 0) flushers.delete(pageId);
	};
}

export async function flushPendingPageSave(pageId: string): Promise<boolean> {
	const registered = flushers.get(pageId);
	if (!registered || registered.size === 0) return true;
	const results = await Promise.all(
		Array.from(registered.values(), (flush) => flush()),
	);
	return results.every(Boolean);
}
