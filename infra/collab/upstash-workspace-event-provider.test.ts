import { describe, expect, it } from "bun:test";
import { createWorkspaceTaskEvent } from "@/features/collab/workspace-events";
import {
	createUpstashWorkspaceEventPorts,
	workspaceEventChannel,
	workspaceEventStreamLeaseKey,
} from "./upstash-workspace-event-provider";

type Message = { channel: string; message: unknown };

function createFakeRedis() {
	let messageHandler: ((message: Message) => void) | null = null;
	let errorHandler: ((error: unknown) => void) | null = null;
	let readyHandler: (() => void) | null = null;
	let unsubscribed = false;
	let leaseResult = 1;
	const published: Array<{ channel: string; message: unknown }> = [];
	const evalCalls: Array<{
		script: string;
		keys: string[];
		args: unknown[];
	}> = [];
	const removedLeases: Array<{ key: string; members: unknown[] }> = [];
	const subscriber = {
		on(
			event: "subscribe" | "message" | "error",
			handler: (value: never) => void,
		) {
			if (event === "message") {
				messageHandler = handler as (message: Message) => void;
			} else if (event === "subscribe") {
				readyHandler = handler as () => void;
			} else {
				errorHandler = handler as (error: unknown) => void;
			}
		},
		removeAllListeners() {
			messageHandler = null;
			errorHandler = null;
			readyHandler = null;
		},
		async unsubscribe() {
			unsubscribed = true;
		},
	};
	return {
		redis: {
			async publish(channel: string, message: unknown) {
				published.push({ channel, message });
				return 1;
			},
			subscribe() {
				return subscriber;
			},
			async eval<TArgs extends unknown[], TData = unknown>(
				script: string,
				keys: string[],
				args: TArgs,
			) {
				evalCalls.push({ script, keys, args });
				return leaseResult as TData;
			},
			async zrem<TData>(key: string, ...members: TData[]) {
				removedLeases.push({ key, members });
				return members.length;
			},
		},
		published,
		evalCalls,
		removedLeases,
		setLeaseResult(result: number) {
			leaseResult = result;
		},
		emit(message: Message) {
			messageHandler?.(message);
		},
		emitReady() {
			readyHandler?.();
		},
		emitError(error: unknown) {
			errorHandler?.(error);
		},
		wasUnsubscribed: () => unsubscribed,
	};
}

describe("Upstash workspace event provider", () => {
	it("publishes and subscribes on a workspace-isolated channel", async () => {
		const fake = createFakeRedis();
		const prefix = "haunter:test:events";
		const ports = createUpstashWorkspaceEventPorts({
			redis: fake.redis,
			prefix,
		});
		const event = createWorkspaceTaskEvent({
			workspaceId: "workspace_1",
			taskId: "task_1",
		});
		const received: unknown[] = [];
		const errors: unknown[] = [];
		let ready = false;
		const subscription = ports.workspaceEventSubscriptions.subscribe({
			workspaceId: "workspace_1",
			onReady: () => {
				ready = true;
			},
			onEvent: (message) => received.push(message),
			onError: (error) => errors.push(error),
		});
		fake.emitReady();
		expect(ready).toBe(true);

		await ports.workspaceEvents.publish(event);
		expect(fake.published).toEqual([
			{
				channel: workspaceEventChannel(prefix, "workspace_1"),
				message: event,
			},
		]);

		fake.emit({
			channel: workspaceEventChannel(prefix, "workspace_1"),
			message: event,
		});
		fake.emit({
			channel: workspaceEventChannel(prefix, "workspace_2"),
			message: event,
		});
		fake.emit({
			channel: workspaceEventChannel(prefix, "workspace_1"),
			message: { ...event, workspaceId: "workspace_2" },
		});
		expect(received).toEqual([event]);
		const transportError = new Error("stream failed");
		fake.emitError(transportError);
		expect(errors).toEqual([transportError]);

		await subscription?.unsubscribe();
		expect(fake.wasUnsubscribed()).toBe(true);
	});

	it("atomically caps and releases active streams per user", async () => {
		const fake = createFakeRedis();
		const prefix = "haunter:test:events";
		const ports = createUpstashWorkspaceEventPorts({
			redis: fake.redis,
			prefix,
		});

		const lease = await ports.workspaceEventStreamLeases.acquire({
			userId: "user_1",
			maxConnections: 8,
			ttlMs: 300_000,
		});
		expect(lease).not.toBeNull();
		expect(fake.evalCalls).toHaveLength(1);
		const [call] = fake.evalCalls;
		expect(call?.keys).toEqual([
			workspaceEventStreamLeaseKey(prefix, "user_1"),
		]);
		expect(call?.args[3]).toBe(8);
		expect(call?.args[4]).toBe(360_000);
		expect(typeof call?.args[2]).toBe("string");

		await lease?.release();
		await lease?.release();
		expect(fake.removedLeases).toEqual([
			{
				key: workspaceEventStreamLeaseKey(prefix, "user_1"),
				members: [call?.args[2]],
			},
		]);

		fake.setLeaseResult(0);
		await expect(
			ports.workspaceEventStreamLeases.acquire({
				userId: "user_1",
				maxConnections: 8,
				ttlMs: 300_000,
			}),
		).resolves.toBeNull();
	});

	it("degrades to no-op ports without Redis credentials", async () => {
		const ports = createUpstashWorkspaceEventPorts({
			redis: null,
			prefix: "haunter:test:events",
		});
		expect(ports.workspaceEventSubscriptions.isConfigured()).toBe(false);
		expect(ports.workspaceEventStreamLeases.isConfigured()).toBe(false);
		await expect(
			ports.workspaceEventStreamLeases.acquire({
				userId: "user_1",
				maxConnections: 8,
				ttlMs: 300_000,
			}),
		).resolves.toBeNull();
		expect(
			ports.workspaceEventSubscriptions.subscribe({
				workspaceId: "workspace_1",
				onReady() {},
				onEvent() {},
				onError() {},
			}),
		).toBeNull();
		await expect(
			ports.workspaceEvents.publish(
				createWorkspaceTaskEvent({
					workspaceId: "workspace_1",
					taskId: "task_1",
				}),
			),
		).resolves.toBeUndefined();
	});
});
