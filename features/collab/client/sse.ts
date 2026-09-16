"use client";

import type { WorkspaceEvent } from "@/features/collab/workspace-events";
import {
	readWorkspaceEventClock,
	type WorkspaceEventClock,
} from "./event-clock";

const INITIAL_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 30_000;

/** Subscribe to same-origin, membership-authorized workspace invalidations. */
export function bindWorkspaceEvents(
	workspaceId: string,
	input: {
		onEvent(event: WorkspaceEvent, clock: WorkspaceEventClock | null): void;
		onConnected(): void;
		onConnectionError?(): void;
	},
): () => void {
	let disposed = false;
	let source: EventSource | null = null;
	let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	let reconnectDelay = INITIAL_RECONNECT_DELAY_MS;

	const connect = () => {
		if (disposed) return;
		const connection = new EventSource(
			`/api/workspaces/${encodeURIComponent(workspaceId)}/events`,
		);
		source = connection;
		let clock: WorkspaceEventClock | null = null;
		connection.addEventListener("connected", (event) => {
			if (disposed || source !== connection) return;
			const receivedAt = performance.now();
			try {
				clock = readWorkspaceEventClock(
					JSON.parse((event as MessageEvent<string>).data),
					receivedAt,
				);
			} catch {
				clock = null;
			}
			reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
			input.onConnected();
		});
		connection.addEventListener("workspace-event", (event) => {
			if (disposed || source !== connection) return;
			try {
				input.onEvent(JSON.parse((event as MessageEvent<string>).data), clock);
			} catch {
				// Ignore malformed transport data; the next valid event or reconnect
				// refresh restores the authoritative SQLite projections.
			}
		});
		connection.addEventListener("error", () => {
			if (disposed || source !== connection) return;
			clock = null;
			input.onConnectionError?.();
			connection.close();
			source = null;
			if (disposed || reconnectTimer) return;
			reconnectTimer = setTimeout(() => {
				reconnectTimer = null;
				connect();
			}, reconnectDelay);
			reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY_MS);
		});
	};

	connect();
	return () => {
		disposed = true;
		if (reconnectTimer) clearTimeout(reconnectTimer);
		source?.close();
	};
}
