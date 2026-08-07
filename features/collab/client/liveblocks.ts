"use client";

import { type Client, createClient } from "@liveblocks/client";
import type { WorkspaceEvent } from "@/features/collab/workspace-events";

const clients = new Map<string, Client>();

function getLiveblocksClient(userId: string): Client {
	const cached = clients.get(userId);
	if (cached) return cached;
	const client = createClient({ authEndpoint: "/api/liveblocks-auth" });
	clients.set(userId, client);
	return client;
}

/** Join the storage-free workspace room used only for server-originated
 * invalidation hints. SQLite remains the source of truth for every payload. */
export function bindWorkspaceEvents(
	roomId: string,
	userId: string,
	input: {
		onEvent(event: WorkspaceEvent): void;
		onConnected(): void;
	},
): () => void {
	const { room, leave } = getLiveblocksClient(userId).enterRoom<
		Record<string, never>,
		Record<string, never>,
		WorkspaceEvent
	>(roomId);
	const unsubscribeEvent = room.subscribe("event", ({ event }) => {
		input.onEvent(event);
	});
	const unsubscribeStatus = room.subscribe("status", (status) => {
		if (status === "connected") input.onConnected();
	});
	if (room.getStatus() === "connected") input.onConnected();

	return () => {
		unsubscribeEvent();
		unsubscribeStatus();
		leave();
	};
}
