import "@beignet/core/server-only";
import type { AppContext } from "@/app-context";
import { appError } from "@/features/shared/errors";
import { requireUser } from "@/lib/auth";
import { env } from "@/lib/env";

export const WORKSPACE_BROADCAST_LIFETIME_MS = 240_000;
export const WORKSPACE_BROADCAST_LEASE_TTL_MS = 300_000;

export async function admitWorkspaceBroadcast({
	ctx,
	signal,
}: {
	ctx: AppContext;
	signal: AbortSignal;
}) {
	const user = requireUser(ctx);
	if (!ctx.ports.workspaceEventStreamLeases.isConfigured())
		throw appError("BroadcastUnavailable");
	signal.throwIfAborted();
	const lease = await ctx.ports.workspaceEventStreamLeases
		.acquire({
			userId: user.id,
			maxConnections: env.UPSTASH_WORKSPACE_EVENT_MAX_CONNECTIONS_PER_USER,
			ttlMs: WORKSPACE_BROADCAST_LEASE_TTL_MS,
		})
		.catch(() => {
			throw appError("BroadcastUnavailable");
		});
	if (!lease)
		throw appError("BroadcastConnectionLimit", {
			headers: { "Retry-After": "30" },
		});
	// Return ownership even after cancellation; Beignet releases late acquisitions.
	return () => lease.release();
}
