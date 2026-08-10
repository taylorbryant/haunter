import { describe, expect, it } from "bun:test";
import { createWorkspaceEventStream } from "../server/workspace-event-stream";
import {
	createWorkspaceTaskEvent,
	type WorkspaceEvent,
	type WorkspaceEventSubscriberPort,
} from "../workspace-events";

function createSubscriberFixture() {
	let onEvent: ((event: WorkspaceEvent) => void) | null = null;
	let unsubscribed = false;
	const subscriptions: WorkspaceEventSubscriberPort = {
		isConfigured: () => true,
		subscribe(input) {
			onEvent = input.onEvent;
			input.onReady();
			return {
				async unsubscribe() {
					unsubscribed = true;
				},
			};
		},
	};
	return {
		subscriptions,
		emit(event: WorkspaceEvent) {
			onEvent?.(event);
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
});
