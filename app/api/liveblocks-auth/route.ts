import { Liveblocks } from "@liveblocks/node";
import {
	liveblocksSessionOptions,
	parseRoomId,
} from "@/features/collab/lib/room";
import { ensureCollaborativeDocument } from "@/features/documents/service";
import { requireActiveWorkspaceScope } from "@/lib/auth";
import { env } from "@/lib/env";
import { getServer } from "@/server";

/**
 * Liveblocks access-token auth: the client asks to enter a room, and this
 * endpoint decides from Haunter's own data. Versioned document rooms and
 * workspace event rooms are granted only to verified members of the entity's
 * workspace — viewers get read-only document access. Everything invalid is a
 * uniform 403.
 *
 * Runs through `server.rawRoute(...)`, so the whole pipeline applies —
 * hooks (the rate limit below is metadata-driven, same as contracts),
 * context creation, instrumentation, and framework error mapping.
 */
export async function POST(req: Request) {
	const secretKey = env.LIVEBLOCKS_SECRET_KEY;
	if (!secretKey) {
		return Response.json(
			{ message: "Collaboration is not configured." },
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
			if (!userId) {
				return new Response(null, { status: 403 });
			}

			const body = (await request.json().catch(() => null)) as {
				room?: string;
			} | null;
			const target = body?.room ? parseRoomId(body.room) : null;
			if (!body?.room || !target) {
				return new Response(null, { status: 403 });
			}
			const scope = requireActiveWorkspaceScope(
				ctx,
				target.kind === "workspace" ? target.id : undefined,
			);

			const workspaceId =
				target.kind === "workspace"
					? target.id
					: target.kind === "page"
						? await ctx.ports.pages
								.findById(scope, target.id)
								.then((page) =>
									page && page.deletedAt === null ? page.workspaceId : null,
								)
						: await ctx.ports.canvases
								.findById(scope, target.id)
								.then(async (canvas) => {
									if (!canvas) return null;
									const page = await ctx.ports.pages.findMetaById(
										scope,
										canvas.pageId,
									);
									return page &&
										page.deletedAt === null &&
										page.workspaceId === canvas.workspaceId
										? canvas.workspaceId
										: null;
								});
			if (!workspaceId) {
				return new Response(null, { status: 403 });
			}
			const role = await ctx.ports.members.findRole(workspaceId, userId);
			if (!role) {
				return new Response(null, { status: 403 });
			}
			if (target.kind !== "workspace") {
				try {
					const ensured = await ensureCollaborativeDocument({
						scope,
						kind: target.kind,
						entityId: target.id,
						ports: ctx.ports,
						verifyReady: true,
					});
					if (ensured.documentId !== body.room) {
						return new Response(null, { status: 403 });
					}
				} catch (error) {
					ctx.ports.logger.error(
						"Failed to prepare an authoritative document room",
						{ roomId: body.room, error },
					);
					return Response.json(
						{ message: "Live editing is temporarily unavailable." },
						{ status: 503 },
					);
				}
			}

			const liveblocks = new Liveblocks({ secret: secretKey });
			if (target.kind === "workspace") {
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
			}
			const session = liveblocks.prepareSession(
				userId,
				liveblocksSessionOptions({
					workspaceId,
					userName: ctx.auth?.user.name || ctx.auth?.user.email || "Member",
				}),
			);
			if (target.kind === "workspace" || role === "viewer") {
				session.allow(body.room, session.READ_ACCESS);
			} else {
				session.allow(body.room, session.FULL_ACCESS);
			}

			const { status, body: token } = await session.authorize();
			return new Response(token, {
				status,
				headers: { "content-type": "application/json" },
			});
		});

	return handler(req);
}
