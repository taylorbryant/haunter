import "@beignet/core/server-only";
import { createProvider } from "@beignet/core/providers";
import { Liveblocks } from "@liveblocks/node";
import type { AgentPresencePort } from "@/features/agents/ports";
import { documentRoomId } from "@/features/collab/lib/room";
import { env } from "@/lib/env";

export const liveblocksAgentPresenceProvider = createProvider()({
	name: "liveblocks-agent-presence",
	setup() {
		const liveblocks = env.LIVEBLOCKS_SECRET_KEY
			? new Liveblocks({ secret: env.LIVEBLOCKS_SECRET_KEY })
			: null;

		const agentPresence: AgentPresencePort = {
			async setPagePresence(presence) {
				if (!liveblocks) return;
				await liveblocks.setPresence(documentRoomId("page", presence.pageId), {
					userId: `agent:${presence.presenceId}`,
					data: {
						kind: "agent",
						status: presence.status,
						capability: presence.capability,
					},
					userInfo: { name: presence.name, color: "#a855f7" },
					ttl: presence.ttlSeconds,
				});
			},
		};

		return { ports: { agentPresence } };
	},
});
