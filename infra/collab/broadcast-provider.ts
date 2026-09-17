import "@beignet/core/server-only";
import type { BroadcastPort } from "@beignet/core/broadcasting/server";
import { createProvider } from "@beignet/core/providers";
import { createRedisBroadcast } from "@beignet/provider-broadcast-redis";
import { Redis } from "@upstash/redis";
import { env } from "@/lib/env";
import { createWorkspaceEventStreamLeases } from "./workspace-stream-leases";

const unconfiguredBroadcast: BroadcastPort = {
	async publish() {},
	subscribe() {
		throw new Error("Workspace broadcasts are not configured");
	},
};

export const workspaceBroadcastProvider = createProvider()({
	name: "workspace-broadcasts",
	setup({ ports }) {
		const broadcast = env.REDIS_BROADCAST_URL
			? createRedisBroadcast({
					url: env.REDIS_BROADCAST_URL,
					prefix: env.REDIS_BROADCAST_PREFIX,
					instrumentation: ports,
				})
			: null;
		const leaseRedis =
			broadcast && env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN
				? new Redis({
						url: env.UPSTASH_REDIS_REST_URL,
						token: env.UPSTASH_REDIS_REST_TOKEN,
					})
				: null;
		return {
			ports: {
				broadcast: broadcast ?? unconfiguredBroadcast,
				workspaceEventStreamLeases: createWorkspaceEventStreamLeases({
					redis: leaseRedis,
					prefix: env.UPSTASH_WORKSPACE_EVENT_PREFIX,
				}),
			},
			// The direct adapter connects on publish/subscribe. Optional live updates
			// must not make Redis availability a prerequisite for booting the app.
			stop: () => broadcast?.close(),
		};
	},
});
