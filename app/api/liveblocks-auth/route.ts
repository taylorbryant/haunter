import { Liveblocks } from "@liveblocks/node";
import { parseRoomId } from "@/features/collab/lib/room";
import { requireActiveWorkspaceScope } from "@/lib/auth";
import { env } from "@/lib/env";
import { getServer } from "@/server";

/**
 * Liveblocks access-token auth: the client asks to enter a room, and this
 * endpoint decides from Haunter's own data. `page:<id>` and `canvas:<id>`
 * rooms are granted to verified members of the entity's workspace — viewers
 * read-only, everyone else full access. Everything invalid is a uniform 403.
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
			const scope = requireActiveWorkspaceScope(ctx);

			const workspaceId =
				target.kind === "page"
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

			const liveblocks = new Liveblocks({ secret: secretKey });
			const session = liveblocks.prepareSession(userId, {
				userInfo: {
					name: ctx.auth?.user.name || ctx.auth?.user.email || "Member",
				},
			});
			if (role === "viewer") {
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
