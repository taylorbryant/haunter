import { createBroadcastRoute } from "@beignet/next";
import { routeAuth } from "@/lib/route-auth";
import { getServer } from "@/server";
import {
	admitWorkspaceBroadcast,
	WORKSPACE_BROADCAST_LIFETIME_MS,
} from "@/server/broadcast-admission";
import { channels } from "@/server/broadcasts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const { GET } = createBroadcastRoute({
	server: getServer,
	channels,
	hooks: [routeAuth.required()],
	metadata: { rateLimit: { max: 10, windowSec: 60, scope: "user" } },
	maxLifetimeMs: WORKSPACE_BROADCAST_LIFETIME_MS,
	admit: admitWorkspaceBroadcast,
});
