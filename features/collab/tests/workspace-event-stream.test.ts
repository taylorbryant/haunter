import { describe, expect, it } from "bun:test";
import { createWorkspaceEventStream } from "@/infra/collab/workspace-event-stream";
import {
	createWorkspaceTaskEvent,
	type WorkspaceEvent,
	type WorkspaceEventSubscriberPort,
} from "../workspace-events";

function createSubscriberFixture(options: { unsubscribeError?: unknown } = {}) {
	let onEvent: ((event: WorkspaceEvent) => void) | null = null;
	let onError: ((error: unknown) => void) | null = null;
	let unsubscribed = false;
	const subscriptions: WorkspaceEventSubscriberPort = {
		isConfigured: () => true,
		subscribe(input) {
			onEvent = input.onEvent;
			onError = input.onError;
			input.onReady();
			return {
				async unsubscribe() {
					unsubscribed = true;
					if (options.unsubscribeError) throw options.unsubscribeError;
				},
			};
		},
	};
	return {
		subscriptions,
		emit(event: WorkspaceEvent) {
			onEvent?.(event);
		},
		fail(error: unknown) {
			onError?.(error);
		},
		wasUnsubscribed: () => unsubscribed,
	};
}

describe("workspace event SSE stream", () => {
	it("returns no stream when the shared transport is unavailable", () => {
		const response = createWorkspaceEventStream({
			workspaceId: "workspace_1",
			signal: new AbortController().signal,
			subscriptions: {
				isConfigured: () => false,
				subscribe: () => null,
			},
			onError() {},
		});

		expect(response).toBeNull();
	});

	it("frames events and releases the Redis subscription on disconnect", async () => {
		const fixture = createSubscriberFixture();
		let leaseReleaseCount = 0;
		const response = createWorkspaceEventStream({
			workspaceId: "workspace_1",
			signal: new AbortController().signal,
			subscriptions: fixture.subscriptions,
			onError(error) {
				throw error;
			},
			onClose() {
				leaseReleaseCount += 1;
			},
			heartbeatMs: 60_000,
			maxLifetimeMs: 60_000,
		});
		expect(response?.headers.get("content-type")).toBe(
			"text/event-stream; charset=utf-8",
		);
		expect(response?.headers.get("cache-control")).toBe(
			"no-store, no-transform",
		);
		expect(response?.headers.get("x-accel-buffering")).toBe("no");
		expect(response?.headers.get("connection")).toBeNull();

		const reader = response?.body?.getReader();
		expect(reader).toBeDefined();
		const decoder = new TextDecoder();
		const connected = await reader?.read();
		expect(decoder.decode(connected?.value)).toBe(
			"event: connected\ndata: {}\n\n",
		);

		const event = createWorkspaceTaskEvent({
			workspaceId: "workspace_1",
			taskId: "task_1",
			occurredAt: "2026-08-09T12:00:00.000Z",
		});
		fixture.emit(event);
		const message = await reader?.read();
		expect(decoder.decode(message?.value)).toBe(
			`event: workspace-event\ndata: ${JSON.stringify(event)}\n\n`,
		);

		await reader?.cancel();
		await Promise.resolve();
		expect(fixture.wasUnsubscribed()).toBe(true);
		expect(leaseReleaseCount).toBe(1);
		await reader?.cancel();
		expect(leaseReleaseCount).toBe(1);
	});

	it("reports subscription failures and releases stream resources", async () => {
		const fixture = createSubscriberFixture();
		const transportError = new Error("Redis subscription failed");
		let releaseCount = 0;
		let resolveRelease: (() => void) | undefined;
		const released = new Promise<void>((resolve) => {
			resolveRelease = resolve;
		});
		let resolveReported: ((error: unknown) => void) | undefined;
		const reported = new Promise<unknown>((resolve) => {
			resolveReported = resolve;
		});
		const response = createWorkspaceEventStream({
			workspaceId: "workspace_1",
			signal: new AbortController().signal,
			subscriptions: fixture.subscriptions,
			onError(error) {
				resolveReported?.(error);
			},
			onClose() {
				releaseCount += 1;
				resolveRelease?.();
			},
			heartbeatMs: 60_000,
			maxLifetimeMs: 60_000,
		});
		const reader = response?.body?.getReader();
		await reader?.read();

		fixture.fail(transportError);

		expect((await reader?.read())?.done).toBe(true);
		expect(await reported).toBe(transportError);
		await released;
		expect(fixture.wasUnsubscribed()).toBe(true);
		expect(releaseCount).toBe(1);
	});

	it("releases the stream lease when Redis cleanup fails", async () => {
		const cleanupError = new Error("Redis unsubscribe failed");
		const fixture = createSubscriberFixture({ unsubscribeError: cleanupError });
		let releaseCount = 0;
		let resolveReported: ((error: unknown) => void) | undefined;
		const reported = new Promise<unknown>((resolve) => {
			resolveReported = resolve;
		});
		const response = createWorkspaceEventStream({
			workspaceId: "workspace_1",
			signal: new AbortController().signal,
			subscriptions: fixture.subscriptions,
			onError(error) {
				resolveReported?.(error);
			},
			onClose() {
				releaseCount += 1;
			},
			heartbeatMs: 60_000,
			maxLifetimeMs: 60_000,
		});
		const reader = response?.body?.getReader();
		await reader?.read();

		await reader?.cancel();

		expect(await reported).toBe(cleanupError);
		expect(fixture.wasUnsubscribed()).toBe(true);
		expect(releaseCount).toBe(1);
	});

	it("releases the stream lease when subscription setup throws", async () => {
		const setupError = new Error("Redis subscribe threw");
		let releaseCount = 0;
		let resolveRelease: (() => void) | undefined;
		const released = new Promise<void>((resolve) => {
			resolveRelease = resolve;
		});
		let resolveReported: ((error: unknown) => void) | undefined;
		const reported = new Promise<unknown>((resolve) => {
			resolveReported = resolve;
		});
		const response = createWorkspaceEventStream({
			workspaceId: "workspace_1",
			signal: new AbortController().signal,
			subscriptions: {
				isConfigured: () => true,
				subscribe() {
					throw setupError;
				},
			},
			onError(error) {
				resolveReported?.(error);
			},
			onClose() {
				releaseCount += 1;
				resolveRelease?.();
			},
			heartbeatMs: 60_000,
			maxLifetimeMs: 60_000,
		});

		expect((await response?.body?.getReader().read())?.done).toBe(true);
		expect(await reported).toBe(setupError);
		await released;
		expect(releaseCount).toBe(1);
	});

	it("releases the stream lease without subscribing when already aborted", async () => {
		const request = new AbortController();
		request.abort();
		let subscribeCount = 0;
		let releaseCount = 0;
		let resolveRelease: (() => void) | undefined;
		const released = new Promise<void>((resolve) => {
			resolveRelease = resolve;
		});
		const response = createWorkspaceEventStream({
			workspaceId: "workspace_1",
			signal: request.signal,
			subscriptions: {
				isConfigured: () => true,
				subscribe() {
					subscribeCount += 1;
					return null;
				},
			},
			onError(error) {
				throw error;
			},
			onClose() {
				releaseCount += 1;
				resolveRelease?.();
			},
		});

		expect((await response?.body?.getReader().read())?.done).toBe(true);
		await released;
		expect(subscribeCount).toBe(0);
		expect(releaseCount).toBe(1);
	});
});
