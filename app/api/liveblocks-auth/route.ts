import { Liveblocks } from "@liveblocks/node";
import { parsePageRoomId } from "@/features/collab/lib/room";
import { env } from "@/lib/env";
import { getServer } from "@/server";

/**
 * Liveblocks access-token auth: the client asks to enter a room, and this
 * endpoint decides from Haunter's own data. A `page:<id>` room is granted to
 * verified members of the page's workspace — viewers read-only, everyone
 * else full access. Everything invalid is a uniform 403.
 */
export async function POST(req: Request) {
	if (!env.LIVEBLOCKS_SECRET_KEY) {
		return Response.json(
			{ message: "Collaboration is not configured." },
			{ status: 503 },
		);
	}

	const server = await getServer();
	const ctx = await server.createContextFromNext();
	const userId = ctx.auth?.user.id;
	if (!userId) {
		return new Response(null, { status: 403 });
	}

	// This route bypasses the contract hooks, so enforce the limit manually.
	const limit = await server.ports.rateLimit.hit({
		key: `collab-auth:${userId}`,
		limit: 300,
		windowSec: 60,
	});
	if (!limit.allowed) {
		return new Response(null, {
			status: 429,
			headers: limit.retryAfterSeconds
				? { "retry-after": String(limit.retryAfterSeconds) }
				: {},
		});
	}

	const body = (await req.json().catch(() => null)) as { room?: string } | null;
	const pageId = body?.room ? parsePageRoomId(body.room) : null;
	if (!body?.room || !pageId) {
		return new Response(null, { status: 403 });
	}

	const page = await server.ports.pages.findById(pageId);
	if (!page || page.deletedAt !== null) {
		return new Response(null, { status: 403 });
	}
	const role = await server.ports.members.findRole(page.workspaceId, userId);
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
