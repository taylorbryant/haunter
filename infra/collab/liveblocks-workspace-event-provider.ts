import "@beignet/core/server-only";
import { createProvider } from "@beignet/core/providers";
import { Liveblocks } from "@liveblocks/node";
import { workspaceRoomId } from "@/features/collab/lib/room";
import type { WorkspaceEventPublisherPort } from "@/features/collab/workspace-events";
import { env } from "@/lib/env";

export const liveblocksWorkspaceEventProvider = createProvider()({
	name: "liveblocks-workspace-events",
	setup() {
		const liveblocks = env.LIVEBLOCKS_SECRET_KEY
			? new Liveblocks({ secret: env.LIVEBLOCKS_SECRET_KEY })
			: null;

		const workspaceEvents: WorkspaceEventPublisherPort = {
			async publish(event) {
				if (!liveblocks) return;
				const roomId = workspaceRoomId(event.workspaceId);
				// A user can subscribe before the first workspace mutation. Both auth
				// and publishing therefore create the same private, storage-free room
				// idempotently. The organization boundary is the workspace itself.
				await liveblocks.getOrCreateRoom(roomId, {
					defaultAccesses: [],
					organizationId: event.workspaceId,
					metadata: {
						app: "haunter",
						channel: "workspace-events",
						schema: "v1",
					},
				});
				await liveblocks.broadcastEvent(roomId, event);
			},
		};

		return { ports: { workspaceEvents } };
	},
});
