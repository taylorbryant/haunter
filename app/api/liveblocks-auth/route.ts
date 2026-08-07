import { Liveblocks } from "@liveblocks/node";
import { tenantScopeId } from "@beignet/core/ports";
import {
	liveblocksSessionOptions,
	parseRoomId,
} from "@/features/collab/lib/room";
import { requireActiveWorkspaceScope } from "@/lib/auth";
import { env } from "@/lib/env";
import { getServer } from "@/server";

/** Authorize the private workspace room used for ephemeral cache-invalidation
 * events. It contains no document storage; SQLite remains authoritative. */
export async function POST(req: Request) {
	const secretKey = env.LIVEBLOCKS_SECRET_KEY;
	if (!secretKey) {
		return Response.json(
			{ message: "Live updates are not configured." },
			{ status: 503 },
		);
	}

	const server = await getServer();
	const handler = server
		.rawRoute({
			name: "liveblocks-auth",
			method: "POST",
			path: "/api/liveblocks-auth",
			metadata: { rateLimit: { max: 300, windowSec: 60, scope: "user" } },
		})
		.handle(async ({ ctx, req: request }) => {
			const userId = ctx.auth?.user.id;
			if (!userId) return new Response(null, { status: 403 });

			const body = (await request.json().catch(() => null)) as {
				room?: string;
			} | null;
			const target = body?.room ? parseRoomId(body.room) : null;
			if (!body?.room || !target) {
				return new Response(null, { status: 403 });
			}

			const scope = requireActiveWorkspaceScope(ctx, target.id);
			const workspaceId = tenantScopeId(scope);
			const role = await ctx.ports.members.findRole(workspaceId, userId);
			if (!role) return new Response(null, { status: 403 });

			const liveblocks = new Liveblocks({ secret: secretKey });
			try {
				await liveblocks.getOrCreateRoom(body.room, {
					defaultAccesses: [],
					organizationId: workspaceId,
					metadata: {
						app: "haunter",
						channel: "workspace-events",
						schema: "v1",
					},
				});
			} catch (error) {
				ctx.ports.logger.error("Failed to prepare workspace event room", {
					workspaceId,
					error,
				});
				return Response.json(
					{ message: "Live updates are temporarily unavailable." },
					{ status: 503 },
				);
			}

			const session = liveblocks.prepareSession(
				userId,
				liveblocksSessionOptions({
					workspaceId,
					userName: ctx.auth?.user.name || ctx.auth?.user.email || "Member",
				}),
			);
			session.allow(body.room, session.READ_ACCESS);
			const { status, body: token } = await session.authorize();
			return new Response(token, {
				status,
				headers: { "content-type": "application/json" },
			});
		});

	return handler(req);
}
