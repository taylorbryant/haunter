"use client";

import type { WorkspaceEvent } from "@/features/collab/workspace-events";

const INITIAL_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 30_000;

/** Subscribe to same-origin, membership-authorized workspace invalidations. */
export function bindWorkspaceEvents(
	workspaceId: string,
	input: {
		onEvent(event: WorkspaceEvent): void;
		onConnected(): void;
	},
): () => void {
	let disposed = false;
	let source: EventSource | null = null;
	let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	let reconnectDelay = INITIAL_RECONNECT_DELAY_MS;

	const connect = () => {
		if (disposed) return;
		source = new EventSource(
			`/api/workspaces/${encodeURIComponent(workspaceId)}/events`,
		);
		source.addEventListener("connected", () => {
			reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
			input.onConnected();
		});
		source.addEventListener("workspace-event", (event) => {
			try {
				input.onEvent(JSON.parse((event as MessageEvent<string>).data));
			} catch {
				// Ignore malformed transport data; the next valid event or reconnect
				// refresh restores the authoritative SQLite projections.
			}
		});
		source.addEventListener("error", () => {
			source?.close();
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
