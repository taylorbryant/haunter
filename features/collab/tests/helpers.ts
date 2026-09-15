import type { InferChannelEvent } from "@beignet/core/broadcasting";
import type {
	BroadcastClient,
	BroadcastConnectionInfo,
} from "@beignet/core/broadcasting/client";
import {
	type BroadcastTransport,
	createBroadcastPort,
} from "@beignet/core/broadcasting/server";
import type { workspaceChanges } from "../channels";

export function deferred<T = void>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}

export async function until(check: () => boolean) {
	for (let i = 0; i < 600; i++) {
		if (check()) return;
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	throw new Error("Condition did not become true");
}

export function memoryBroadcast() {
	const listeners = new Map<
		string,
		Set<Parameters<BroadcastTransport["subscribe"]>[1]>
	>();
	const port = createBroadcastPort({
		async publish(key, message) {
			for (const listener of listeners.get(key) ?? [])
				listener.onMessage(message);
		},
		subscribe(key, listener) {
			const group = listeners.get(key) ?? new Set();
			listeners.set(key, group);
			group.add(listener);
			return {
				ready: Promise.resolve(),
				async unsubscribe() {
					group.delete(listener);
				},
			};
		},
	});
	return {
		port,
		subscriberCount: () =>
			[...listeners.values()].reduce((count, group) => count + group.size, 0),
		disconnect() {
			for (const group of listeners.values())
				for (const listener of group) listener.onDisconnect();
		},
	};
}

export function controlledBroadcastClient() {
	type Observer = {
		onEvent(
			event: InferChannelEvent<typeof workspaceChanges>,
		): void | Promise<void>;
		onSync(info: BroadcastConnectionInfo): void | Promise<void>;
	};
	let observer: Observer | undefined;
	const client: BroadcastClient = {
		subscribe(_channel, options) {
			// This fixture is only used by the workspace channel subscription.
			observer = options as unknown as Observer;
			return {
				unsubscribe() {
					observer = undefined;
				},
				getStatus: () => "connected",
			};
		},
		getRequestHeaders: () => ({}),
		getStatus: () => "connected",
		resume() {},
		close() {
			observer = undefined;
		},
	};
	return {
		client,
		event: (data: Parameters<Observer["onEvent"]>[0]["data"]) =>
			observer?.onEvent({ event: "changed", data }),
		sync: () => observer?.onSync({ reason: "interruption" }),
	};
}
