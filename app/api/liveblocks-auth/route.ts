import { Liveblocks } from "@liveblocks/node";
import { parseRoomId } from "@/features/collab/lib/room";
import { env } from "@/lib/env";
import { getServer } from "@/server";

/**
 * Liveblocks access-token auth: the client asks to enter a room, and this
 * endpoint decides from Haunter's own data. `page:<id>` and `canvas:<id>`
 * rooms are granted to verified members of the entity's workspace — viewers
 * read-only, everyone else full access. Everything invalid is a uniform 403.
 */
export async function POST(req: Request) {
	if (!env.LIVEBLOCKS_SECRET_KEY) {
		return Response.json(
			{ message: "Collaboration is not configured." },
			{ status: 503 },
		);
	}

	// This endpoint gates the editor render on every page navigation, so
	// every independent await below runs in parallel to keep it fast.
	const [server, body] = await Promise.all([
		getServer(),
		req.json().catch(() => null) as Promise<{ room?: string } | null>,
	]);
	const target = body?.room ? parseRoomId(body.room) : null;
	if (!body?.room || !target) {
		return new Response(null, { status: 403 });
	}

	const ctx = await server.createContextFromNext();
	const userId = ctx.auth?.user.id;
	if (!userId) {
		return new Response(null, { status: 403 });
	}

	// The rate-limit hit (this route bypasses the contract hooks, so it is
	// enforced manually) and the entity lookup don't depend on each other.
	const [limit, workspaceId] = await Promise.all([
		server.ports.rateLimit.hit({
			key: `collab-auth:${userId}`,
			limit: 300,
			windowSec: 60,
		}),
		target.kind === "page"
			? server.ports.pages
					.findById(target.id)
					.then((page) =>
						page && page.deletedAt === null ? page.workspaceId : null,
					)
			: server.ports.canvases
					.findById(target.id)
					.then((canvas) => canvas?.workspaceId ?? null),
	]);
	if (!limit.allowed) {
		return new Response(null, {
			status: 429,
			headers: limit.retryAfterSeconds
				? { "retry-after": String(limit.retryAfterSeconds) }
				: {},
		});
	}
	if (!workspaceId) {
		return new Response(null, { status: 403 });
	}
	const role = await server.ports.members.findRole(workspaceId, userId);
	if (!role) {
		return new Response(null, { status: 403 });
	}

	const liveblocks = new Liveblocks({ secret: env.LIVEBLOCKS_SECRET_KEY });
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
}
