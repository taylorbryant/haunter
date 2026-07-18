"use client";

import { useSyncExternalStore } from "react";

export type PageSaveState = "saved" | "pending" | "saving" | "error";

/**
 * Tiny external store so the header can show the editor's save state
 * without threading props through the layout boundary.
 */
let state: PageSaveState = "saved";
const listeners = new Set<() => void>();
const flushers = new Map<string, Map<symbol, () => Promise<boolean>>>();

type DrainPageSaveQueueOptions = {
	clearPendingTimer: () => void;
	hasPendingChanges: () => boolean;
	save: () => Promise<boolean>;
};

type DrainLatestSaveQueueOptions<T> = {
	clearPendingTimer: () => void;
	getInFlightSave: () => Promise<boolean> | null;
	getPendingValue: () => T | null;
	save: (value: T) => Promise<boolean>;
};

export type LatestSaveQueue<T, TResult> = {
	readonly key: string;
	pending: T | null;
	timeout: ReturnType<typeof setTimeout> | null;
	inFlight: Promise<TResult> | null;
};

export type InFlightSaveQueue<TResult> = {
	readonly key: string;
	readonly inFlight: Promise<TResult> | null;
	readonly lastResult: TResult | null;
};

type StoredLatestSaveQueue<T, TResult> = LatestSaveQueue<T, TResult> & {
	consumers: Set<symbol>;
};

/**
 * Keep a latest-value queue alive across React remounts while it still owns a
 * pending or in-flight write. This prevents a returning surface from starting
 * a second, independent queue for the same resource.
 */
export function createLatestSaveQueueStore<T, TResult>() {
	const queues = new Map<string, StoredLatestSaveQueue<T, TResult>>();

	const evictIfIdle = (queue: StoredLatestSaveQueue<T, TResult>) => {
		if (
			queue.consumers.size === 0 &&
			queue.pending === null &&
			queue.timeout === null &&
			queue.inFlight === null &&
			queues.get(queue.key) === queue
		) {
			queues.delete(queue.key);
		}
	};

	return {
		get(key: string): LatestSaveQueue<T, TResult> {
			let queue = queues.get(key);
			if (!queue) {
				queue = {
					key,
					pending: null,
					timeout: null,
					inFlight: null,
					consumers: new Set(),
				};
				queues.set(key, queue);
			}
			return queue;
		},

		retain(queue: LatestSaveQueue<T, TResult>) {
			const stored = queue as StoredLatestSaveQueue<T, TResult>;
			const consumer = Symbol(queue.key);
			stored.consumers.add(consumer);
			return () => {
				stored.consumers.delete(consumer);
				// Effect cleanup and setup for a same-page remount run in one turn.
				// Defer eviction so the replacement can retain this queue first.
				queueMicrotask(() => evictIfIdle(stored));
			};
		},

		evictIfIdle(queue: LatestSaveQueue<T, TResult>) {
			evictIfIdle(queue as StoredLatestSaveQueue<T, TResult>);
		},
	};
}

type StoredInFlightSaveQueue<TResult> = {
	readonly key: string;
	inFlight: Promise<TResult> | null;
	lastResult: TResult | null;
	consumers: Set<symbol>;
};

/**
 * Coordinate one resource's writes across React remounts. A replacement
 * consumer can await the exact preceding write and adopt its result instead
 * of continuing from a stale optimistic-concurrency token.
 */
export function createInFlightSaveQueueStore<TResult>() {
	const queues = new Map<string, StoredInFlightSaveQueue<TResult>>();

	const evictIfIdle = (queue: StoredInFlightSaveQueue<TResult>) => {
		if (
			queue.consumers.size === 0 &&
			queue.inFlight === null &&
			queues.get(queue.key) === queue
		) {
			queues.delete(queue.key);
		}
	};

	return {
		get(key: string): InFlightSaveQueue<TResult> {
			let queue = queues.get(key);
			if (!queue) {
				queue = {
					key,
					inFlight: null,
					lastResult: null,
					consumers: new Set(),
				};
				queues.set(key, queue);
			}
			return queue;
		},

		retain(queue: InFlightSaveQueue<TResult>) {
			const stored = queue as StoredInFlightSaveQueue<TResult>;
			const consumer = Symbol(queue.key);
			stored.consumers.add(consumer);
			return () => {
				stored.consumers.delete(consumer);
				queueMicrotask(() => evictIfIdle(stored));
			};
		},

		track(
			queue: InFlightSaveQueue<TResult>,
			request: Promise<TResult>,
		): Promise<TResult> {
			const stored = queue as StoredInFlightSaveQueue<TResult>;
			let tracked: Promise<TResult>;
			tracked = request
				.then((result) => {
					if (stored.inFlight === tracked) stored.lastResult = result;
					return result;
				})
				.finally(() => {
					if (stored.inFlight === tracked) stored.inFlight = null;
					evictIfIdle(stored);
				});
			stored.inFlight = tracked;
			return tracked;
		},
	};
}

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
		if (registered?.size === 0) {
			flushers.delete(pageId);
		}
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

/**
 * Drain a latest-value queue without letting an older failure strand a newer
 * pending value whose debounce was cleared by the explicit flush.
 */
export async function drainLatestSaveQueue<T>({
	clearPendingTimer,
	getInFlightSave,
	getPendingValue,
	save,
}: DrainLatestSaveQueueOptions<T>): Promise<boolean> {
	while (true) {
		clearPendingTimer();
		const inFlight = getInFlightSave();
		if (inFlight) {
			const saved = await inFlight;
			if (!saved && getPendingValue() === null) return false;
			continue;
		}

		const pending = getPendingValue();
		if (pending === null) return true;
		const saved = await save(pending);
		if (!saved && getPendingValue() === pending) return false;
	}
}
