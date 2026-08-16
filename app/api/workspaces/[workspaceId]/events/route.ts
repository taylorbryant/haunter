import { tenantScopeId } from "@beignet/core/ports";
import {
	createWorkspaceEventStream,
	WORKSPACE_EVENT_STREAM_LEASE_TTL_MS,
} from "@/infra/collab/workspace-event-stream";
import { requireActiveWorkspaceScope } from "@/lib/auth";
import { env } from "@/lib/env";
import { getServer } from "@/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(
	req: Request,
	{ params }: { params: Promise<{ workspaceId: string }> },
) {
	const { workspaceId: requestedWorkspaceId } = await params;
	const server = await getServer();
	const handler = server
		.rawRoute({
			name: "workspace-events",
			method: "GET",
			path: "/api/workspaces/:workspaceId/events",
			metadata: { rateLimit: { max: 10, windowSec: 60, scope: "user" } },
		})
		.handle(async ({ ctx }) => {
			const userId = ctx.auth?.user.id;
			if (!userId) return new Response(null, { status: 403 });

			const scope = requireActiveWorkspaceScope(ctx, requestedWorkspaceId);
			const workspaceId = tenantScopeId(scope);
			const role = await ctx.ports.members.findRole(workspaceId, userId);
			if (!role) return new Response(null, { status: 403 });
			if (
				!ctx.ports.workspaceEventSubscriptions.isConfigured() ||
				!ctx.ports.workspaceEventStreamLeases.isConfigured()
			) {
				return Response.json(
					{ message: "Live updates are not configured." },
					{ status: 503 },
				);
			}

			const lease = await ctx.ports.workspaceEventStreamLeases
				.acquire({
					userId,
					maxConnections: env.UPSTASH_WORKSPACE_EVENT_MAX_CONNECTIONS_PER_USER,
					ttlMs: WORKSPACE_EVENT_STREAM_LEASE_TTL_MS,
				})
				.catch((error) => {
					ctx.ports.logger.warn("Workspace event stream lease unavailable", {
						workspaceId,
						error,
					});
					return undefined;
				});
			if (lease === undefined) {
				return Response.json(
					{ message: "Live updates are temporarily unavailable." },
					{ status: 503 },
				);
			}
			if (!lease) {
				return Response.json(
					{ message: "Too many active live-update connections." },
					{ status: 429, headers: { "retry-after": "30" } },
				);
			}

			try {
				const response = createWorkspaceEventStream({
					workspaceId,
					signal: req.signal,
					subscriptions: ctx.ports.workspaceEventSubscriptions,
					onClose: () => lease.release(),
					onError(error) {
						ctx.ports.logger.warn("Workspace event stream disconnected", {
							workspaceId,
							error,
						});
					},
				});
				if (response) return response;
			} catch (error) {
				await lease.release().catch((releaseError) => {
					ctx.ports.logger.warn("Workspace event stream lease release failed", {
						workspaceId,
						error: releaseError,
					});
				});
				throw error;
			}

			await lease.release();
			return Response.json(
				{ message: "Live updates are not configured." },
				{ status: 503 },
			);
		});

	return handler(req);
}
