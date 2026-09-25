import type { InferChannelEvent } from "@beignet/core/broadcasting";
import type {
	BroadcastClient,
	BroadcastClientStatus,
	BroadcastConnectionInfo,
} from "@beignet/core/broadcasting/client";
import {
	type BroadcastTransport,
	createBroadcastPort,
} from "@beignet/core/broadcasting/server";
import { workspaceChanges, workspaceCanvasActivity } from "../channels";
import type { CanvasAgentActivity } from "@/features/agents/canvas-activity";
import type { WorkspaceEvent } from "../workspace-events";

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
			event:
				| InferChannelEvent<typeof workspaceChanges>
				| InferChannelEvent<typeof workspaceCanvasActivity>,
		): void | Promise<void>;
		onSync(info: BroadcastConnectionInfo): void | Promise<void>;
		onStatusChange?(status: BroadcastClientStatus): void;
	};
	type ChannelName =
		| typeof workspaceChanges.name
		| typeof workspaceCanvasActivity.name;
	const observers = new Map<ChannelName, Observer>();
	const client: BroadcastClient = {
		subscribe(channel, options) {
			const name = channel.name as ChannelName;
			observers.set(name, options as unknown as Observer);
			return {
				unsubscribe() {
					observers.delete(name);
				},
				getStatus: () => "connected",
			};
		},
		getRequestHeaders: () => ({}),
		getStatus: () => "connected",
		resume() {},
		close() {
			observers.clear();
		},
	};
	return {
		client,
		event: (data: WorkspaceEvent) =>
			observers.get(workspaceChanges.name)?.onEvent({ event: "changed", data }),
		canvasEvent: (data: CanvasAgentActivity) =>
			observers
				.get(workspaceCanvasActivity.name)
				?.onEvent({ event: "activity", data }),
		sync: (channel: ChannelName = workspaceChanges.name) =>
			observers.get(channel)?.onSync({ reason: "interruption" }),
		status: (
			status: BroadcastClientStatus,
			channel: ChannelName = workspaceChanges.name,
		) => observers.get(channel)?.onStatusChange?.(status),
	};
}
