import { getServer } from "@/server";

/**
 * Serve files embedded in a shared page to anonymous visitors. The share
 * token is the authorization; it only reaches objects under the shared
 * page's own key prefix (pages/<workspaceId>/<pageId>/...), so a token never
 * unlocks the rest of the workspace's storage. Everything else — revoked
 * token, trashed page, foreign key — is a uniform 404.
 */
export async function GET(
	_req: Request,
	{ params }: { params: Promise<{ token: string; key: string[] }> },
) {
	const { token, key: segments } = await params;
	const server = await getServer();

	// This route bypasses the contract hooks, so enforce the limit manually.
	// Keyed by token: abuse of one leaked link can't starve other shares.
	const limit = await server.ports.rateLimit.hit({
		key: `share-files:${token}`,
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

	const share = await server.ports.shares.findByToken(token);
	if (!share) {
		return new Response(null, { status: 404 });
	}

	const page = await server.ports.pages.findMetaById(share.pageId);
	if (!page || page.deletedAt !== null) {
		return new Response(null, { status: 404 });
	}

	const key = segments.join("/");
	if (!key.startsWith(`pages/${share.workspaceId}/${share.pageId}/`)) {
		return new Response(null, { status: 404 });
	}

	const object = await server.ports.storage.get(key);
	if (!object) {
		return new Response(null, { status: 404 });
	}

	return new Response(object.stream(), {
		headers: {
			"content-type": object.contentType ?? "application/octet-stream",
			"content-length": String(object.size),
			// The share URL is already capability-scoped; long cache is safe
			// because upload keys are immutable.
			"cache-control": object.cacheControl ?? "private, max-age=0",
		},
	});
}
