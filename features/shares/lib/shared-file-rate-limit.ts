import type { RateLimitPort } from "@beignet/core/ports";

type RateLimitServer = {
	ports: {
		rateLimit: RateLimitPort;
	};
};

function sharedFileIp(req: Request): string {
	const forwardedFor = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
	return forwardedFor || req.headers.get("x-real-ip")?.trim() || "unknown";
}

async function hitSharedFileLimit(
	rateLimit: RateLimitPort,
	key: string,
): Promise<Response | null> {
	const limit = await rateLimit.hit({
		key,
		limit: 300,
		windowSec: 60,
	});
	if (limit.allowed) return null;

	return new Response(null, {
		status: 429,
		headers: limit.retryAfterSeconds
			? { "retry-after": String(limit.retryAfterSeconds) }
			: {},
	});
}

export async function enforceSharedFileRateLimit(
	server: RateLimitServer,
	req: Request,
): Promise<Response | null> {
	return hitSharedFileLimit(
		server.ports.rateLimit,
		`share-files:ip:${sharedFileIp(req)}`,
	);
}

export async function enforceSharedFileTokenRateLimit(
	server: RateLimitServer,
	token: string,
): Promise<Response | null> {
	return hitSharedFileLimit(server.ports.rateLimit, `share-files:token:${token}`);
}
